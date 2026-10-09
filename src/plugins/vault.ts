/**
 * Vault 服务：保险库的加解密、持久化与增删改查。
 *
 * 条目核心只有 标题/用户名/密码，其余一切（分类、网址、备注、标签…）都是
 * extra 里的自由键值。文件格式 v2 起采用该模型；读取 v1 旧文件时会自动
 * 把 category/url/notes/tags 折进 extra。
 *
 * 文件格式（单文件 JSON）：
 * {
 *   format: 'pmvault', version: 2,
 *   kdf:    { algo, N, r, p, salt },      // 主密码 -> KEK
 *   wrapped:{ ...Sealed },                // KEK 封装 DEK
 *   vault:  { ...Sealed },                // DEK 加密条目数据
 *   meta:   { createdAt, updatedAt }
 * }
 */
import { Context, Service } from 'cordis'
import z from 'schemastery'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  AAD_DATA, AAD_DEK, createKdfParams, deriveKey, randomKey, seal, unseal,
  type KdfParams, type Sealed,
} from '../crypto.ts'
import { localeTag, t } from '../i18n/index.ts'
import { exportCSV, exportJSON, newEntryId, parseImportCSV, parseImportJSON } from '../serialize.ts'
import type { Entry, EntryInput, VaultData, VaultSettings } from '../types.ts'
import {
  BUILTIN_CATEGORIES, CATEGORY_KEY, entryCategory, isBuiltinCategory, normalizeExtra, parseCategory,
} from '../types.ts'

declare module 'cordis' {
  interface Context {
    vault: Vault
  }

  interface Events {
    'vault/unlock'(this: Vault): void
    'vault/lock'(this: Vault): void
    'vault/change'(this: Vault, action: string, entry?: Entry): void
  }
}

interface VaultFile {
  format: 'pmvault'
  version: 1 | 2
  kdf: KdfParams
  wrapped: Sealed
  vault: Sealed
  meta: { createdAt: string; updatedAt: string }
}

/** 写入时使用的格式版本 */
const VAULT_VERSION = 2

interface VaultConfig {
  /** 保险库文件路径 */
  file: string
}

const Config: z<VaultConfig> = z.object({
  file: z.string().required().description(t('cli.file.pathDesc')),
})

export class VaultError extends Error {
  name = 'VaultError'
}

/** 主密码错误（或文件被篡改导致认证失败） */
export class InvalidPasswordError extends VaultError {
  name = 'InvalidPasswordError'
  constructor() {
    super(t('common.errors.invalidPassword'))
  }
}

export class VaultLockedError extends VaultError {
  name = 'VaultLockedError'
  constructor() {
    super(t('common.errors.locked'))
  }
}

export class VaultExistsError extends VaultError {
  name = 'VaultExistsError'
  constructor(file: string) {
    super(t('common.errors.exists', { file }))
  }
}

export class VaultNotFoundError extends VaultError {
  name = 'VaultNotFoundError'
}

export class VaultAmbiguousError extends VaultError {
  name = 'VaultAmbiguousError'
  matches: Entry[]

  constructor(query: string, matches: Entry[]) {
    super(t('common.errors.ambiguous', { query, n: matches.length }) + '\n' + matches
      .map(entry => `  - ${entry.title}${entry.username ? ` (${entry.username})` : ''}  id=${entry.id.slice(0, 8)}`)
      .join('\n'))
    this.matches = matches
  }
}

export class VaultConflictError extends VaultError {
  name = 'VaultConflictError'
  constructor(message = t('common.errors.conflict')) {
    super(message)
  }
}

interface ListFilter {
  /** 按 extra.category 过滤（任意自定义分类） */
  category?: string
  /** 只看没有 category 的条目 */
  uncategorized?: boolean
  query?: string
}

interface ImportResult {
  imported: number
  skipped: number
}

interface ImportOptions {
  /** 跳过 title/username/category 完全相同的条目（默认 true） */
  skipDuplicates?: boolean
}

/** 更新补丁：extra 按键合并，值为空串表示删除该键 */
export interface EntryPatch {
  title?: string
  username?: string
  password?: string
  extra?: Record<string, string>
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function fileDigest(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** 超过这个时长的锁文件视为进程崩溃后的残留，可安全清理 */
const LOCK_STALE_MS = 10_000
const LOCK_WAIT_MS = 3_000

/** 独占锁文件：拿到锁才允许走"读-校验-写-改名"全流程 */
async function acquireLock(lockPath: string): Promise<fs.promises.FileHandle> {
  const deadline = Date.now() + LOCK_WAIT_MS
  for (;;) {
    try {
      const handle = await fs.promises.open(lockPath, 'wx', 0o600)
      await handle.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() })).catch(() => {})
      return handle
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      try {
        const stat = await fs.promises.stat(lockPath)
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          await fs.promises.unlink(lockPath)
          continue
        }
      } catch {
        continue // 锁刚被释放，立即重试
      }
      if (Date.now() > deadline) {
        throw new VaultConflictError(t('common.errors.lockBusy'))
      }
      await sleep(50)
    }
  }
}

/** 解析并严格校验一段保险库文件内容；source 用于错误信息里标识来源 */
function parseVaultFile(content: string, source: string): VaultFile {
  let file: VaultFile
  try {
    file = JSON.parse(content) as VaultFile
  } catch {
    throw new VaultError(t('common.errors.badJson', { source }))
  }
  if (file?.format !== 'pmvault' || (file.version !== 1 && file.version !== 2) || !file.wrapped || !file.vault) {
    throw new VaultError(t('common.errors.badFormat', { source }))
  }
  file.kdf = validateKdf(file.kdf)
  return file
}

/** 校验文件里的 KDF 参数，避免恶意文件触发超大内存分配 */
function validateKdf(raw: any): KdfParams {
  if (!raw || raw.algo !== 'scrypt') throw new VaultError(t('common.errors.kdfAlgo'))
  const { N, r, p, salt } = raw
  if (!Number.isInteger(N) || N < 1 << 12 || N > 1 << 22 || (N & (N - 1)) !== 0) {
    throw new VaultError(t('common.errors.kdfN'))
  }
  if (!Number.isInteger(r) || r < 1 || r > 32) throw new VaultError(t('common.errors.kdfR'))
  if (!Number.isInteger(p) || p < 1 || p > 16) throw new VaultError(t('common.errors.kdfP'))
  if (128 * N * r > 1024 * 1024 * 1024) throw new VaultError(t('common.errors.kdfMemory'))
  if (typeof salt !== 'string' || Buffer.from(salt, 'base64').length < 8) {
    throw new VaultError(t('common.errors.kdfSalt'))
  }
  return { algo: 'scrypt', N, r, p, salt }
}

export class Vault extends Service<VaultConfig> {
  static Config = Config

  config: VaultConfig

  private dek: Buffer | null = null
  private data: VaultData | null = null
  /** 解锁时文件的哈希，用于检测其他进程的并发修改 */
  private digest: string | null = null
  /** 串行化同一进程内的写操作，避免 await 期间互相交错 */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(ctx: Context, config: VaultConfig) {
    super(ctx, 'vault')
    this.config = config
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.then(() => {}, () => {})
    return run
  }

  /** 跨进程文件锁：让"读-校验-写-改名"整段互斥，避免两个 pm 互相覆盖 */
  private async withFileLock<T>(task: () => Promise<T>): Promise<T> {
    const lockPath = this.config.file + '.lock'
    // 锁文件必须先于数据文件创建，所以这里（而不是 persist 里）就要保证目录存在
    const dir = path.dirname(lockPath)
    try {
      await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 })
      await fs.promises.chmod(dir, 0o700).catch(() => {})
    } catch (error) {
      throw new VaultError(t('common.errors.dataDir', { dir, message: (error as Error).message }))
    }
    const handle = await acquireLock(lockPath)
    try {
      return await task()
    } finally {
      await handle.close().catch(() => {})
      await fs.promises.unlink(lockPath).catch(() => {})
    }
  }

  /**
   * 取当前数据的工作副本。所有修改都先落在副本上，
   * 写盘成功后才提交回 this.data —— 持久化失败不会留下幽灵状态。
   */
  private draft(): VaultData {
    if (!this.dek || !this.data) throw new VaultLockedError()
    return structuredClone(this.data)
  }

  private async persistData(draft: VaultData): Promise<void> {
    const dek = this.dek
    if (!dek) throw new VaultLockedError()
    const { file, content } = await this.readFile()
    if (this.digest && fileDigest(content) !== this.digest) throw new VaultConflictError()
    // readFile 是异步的，期间可能被 lock() 或另一个 unlock() 换掉会话
    if (this.dek !== dek) throw new VaultLockedError()

    file.version = VAULT_VERSION
    file.vault = seal(JSON.stringify(draft), dek, AAD_DATA)
    file.meta.updatedAt = new Date().toISOString()
    await this.persist(file)
    this.digest = fileDigest(JSON.stringify(file, null, 2))
  }

  get path(): string {
    return this.config.file
  }

  get unlocked(): boolean {
    return this.dek !== null
  }

  count(category?: string): number {
    if (!this.data) return 0
    if (!category) return this.data.entries.length
    return this.data.entries.filter(entry => entryCategory(entry) === category).length
  }

  /**
   * 全部已知分类：内置的排在前面，随后是用户显式登记的，最后是从条目里发现的。
   * 分类不存在"必须预先定义"的说法，随便写一个用起来就会出现在这里。
   */
  categories(): string[] {
    const data = this.assertUnlocked()
    const hidden = new Set(data.settings?.hidden ?? [])
    const result: string[] = BUILTIN_CATEGORIES.filter(name => !hidden.has(name))
    const push = (value: string | undefined) => {
      const name = value?.trim()
      if (name && !hidden.has(name) && !result.includes(name)) result.push(name)
    }
    for (const name of data.settings?.categories ?? []) push(name)
    for (const entry of data.entries) push(entryCategory(entry))
    return result
  }

  private hideCategory(draft: VaultData, name: string): void {
    const settings = draft.settings ?? (draft.settings = {})
    const hidden = settings.hidden ?? (settings.hidden = [])
    if (!hidden.includes(name)) hidden.push(name)
    if (settings.categories) {
      const index = settings.categories.indexOf(name)
      if (index >= 0) settings.categories.splice(index, 1)
      if (!settings.categories.length) delete settings.categories
    }
  }

  /** 显式登记一个分类（用它建过条目后，即使条目被删也保留在列表里） */
  async registerCategory(name: string): Promise<string[]> {
    const category = parseCategory(name)
    if (!category) throw new VaultError(t('common.errors.categoryRequired'))
    return this.serialize(() => this.withFileLock(async () => {
      const draft = this.draft()
      const settings = draft.settings ?? (draft.settings = {})
      // 之前被移除过的分类，重新添加即恢复
      const hidden = settings.hidden ?? []
      const hiddenIndex = hidden.indexOf(category)
      const known = this.categories().includes(category) && hiddenIndex < 0
      if (known) return this.categories()

      if (hiddenIndex >= 0) hidden.splice(hiddenIndex, 1)
      if (!hidden.length) delete settings.hidden
      if (!isBuiltinCategory(category)) {
        const list = settings.categories ?? (settings.categories = [])
        if (!list.includes(category)) list.push(category)
      }
      await this.persistData(draft)
      this.data = draft
      this.ctx.emit(this, 'vault/change', 'category-add')
      return this.categories()
    }))
  }

  /** 重命名分类：条目里的值、登记列表一并更新 */
  async renameCategory(from: string, to: string): Promise<{ entries: number }> {
    const source = parseCategory(from)
    const target = parseCategory(to)
    if (!source) throw new VaultError(t('common.errors.sourceCategoryRequired'))
    if (!target) throw new VaultError(t('common.errors.targetCategoryRequired'))
    if (source === target) return { entries: 0 }

    return this.serialize(() => this.withFileLock(async () => {
      const draft = this.draft()
      let changed = 0
      for (const entry of draft.entries) {
        if (entryCategory(entry) !== source) continue
        entry.extra = { ...entry.extra, [CATEGORY_KEY]: target }
        entry.updatedAt = new Date().toISOString()
        changed++
      }
      this.hideCategory(draft, source)
      if (!isBuiltinCategory(target)) {
        const settings = draft.settings ?? (draft.settings = {})
        const list = settings.categories ?? (settings.categories = [])
        if (!list.includes(target)) list.push(target)
      }
      // 目标若曾被移除过，重命名后应当出现
      const hidden = draft.settings?.hidden ?? []
      const hiddenIndex = hidden.indexOf(target)
      if (hiddenIndex >= 0) hidden.splice(hiddenIndex, 1)
      if (hidden.length === 0 && draft.settings) delete draft.settings.hidden

      await this.persistData(draft)
      this.data = draft
      this.ctx.emit(this, 'vault/change', 'category-rename')
      return { entries: changed }
    }))
  }

  /**
   * 删除分类：从列表移除（内置分类记入 hidden），使用该分类的条目变为未分类。
   * 条目本身不受影响；之后用同名重新添加即可恢复。
   */
  async deleteCategory(name: string): Promise<{ entries: number }> {
    const category = parseCategory(name)
    if (!category) throw new VaultError(t('common.errors.categoryRequired'))

    return this.serialize(() => this.withFileLock(async () => {
      const draft = this.draft()
      let changed = 0
      for (const entry of draft.entries) {
        if (entryCategory(entry) !== category) continue
        delete entry.extra![CATEGORY_KEY]
        if (!Object.keys(entry.extra!).length) delete entry.extra
        entry.updatedAt = new Date().toISOString()
        changed++
      }
      this.hideCategory(draft, category)

      await this.persistData(draft)
      this.data = draft
      this.ctx.emit(this, 'vault/change', 'category-delete')
      return { entries: changed }
    }))
  }

  /** 把用到的分类记进登记列表（新增/修改条目时自动调用） */
  private rememberCategory(draft: VaultData, value: string | undefined): void {
    const name = value?.trim()
    if (!name || isBuiltinCategory(name)) return
    const settings = draft.settings ?? (draft.settings = {})
    const list = settings.categories ?? (settings.categories = [])
    if (!list.includes(name)) list.push(name)
  }

  exists(): boolean {
    return fs.existsSync(this.config.file)
  }

  /** 新建保险库并设置为已解锁状态 */
  async create(masterPassword: string, options: { force?: boolean } = {}): Promise<void> {
    if (this.exists() && !options.force) throw new VaultExistsError(this.config.file)
    return this.serialize(() => this.withFileLock(() => this.doCreate(masterPassword)))
  }

  private async doCreate(masterPassword: string): Promise<void> {
    // 覆盖已有会话时先擦除旧的 DEK
    this.dek?.fill(0)
    this.dek = null
    this.data = null

    const dek = randomKey()
    const kdf = createKdfParams()
    const kek = deriveKey(masterPassword, kdf)
    const data: VaultData = { version: VAULT_VERSION, entries: [] }
    const now = new Date().toISOString()
    let file: VaultFile
    try {
      file = {
        format: 'pmvault',
        version: VAULT_VERSION,
        kdf,
        wrapped: seal(dek, kek, AAD_DEK),
        vault: seal(JSON.stringify(data), dek, AAD_DATA),
        meta: { createdAt: now, updatedAt: now },
      }
    } finally {
      kek.fill(0)
    }

    this.dek = dek
    this.data = data
    this.digest = null
    await this.persist(file)
    this.digest = fileDigest(JSON.stringify(file, null, 2))
  }

  async unlock(masterPassword: string): Promise<void> {
    const { file, content } = await this.readFile()
    const kek = deriveKey(masterPassword, file.kdf)
    let dek: Buffer
    try {
      dek = unseal(file.wrapped, kek, AAD_DEK)
    } catch {
      throw new InvalidPasswordError()
    } finally {
      kek.fill(0)
    }

    let plaintext: Buffer
    try {
      plaintext = unseal(file.vault, dek, AAD_DATA)
    } catch {
      dek.fill(0)
      throw new VaultError(t('common.errors.integrity'))
    }

    let data: VaultData
    try {
      data = normalizeData(JSON.parse(plaintext.toString('utf8')))
    } catch (error) {
      dek.fill(0)
      throw new VaultError(t('common.errors.parseVault', { message: (error as Error).message }))
    } finally {
      plaintext.fill(0)
    }

    // 清掉旧会话状态后再装载新解密的密钥与数据
    this.lock(false)
    this.dek = dek
    this.data = data
    this.digest = fileDigest(content)
    this.ctx.emit(this, 'vault/unlock')
  }

  /** 锁定并尽力擦除内存中的密钥 */
  lock(emit = true): void {
    this.dek?.fill(0)
    this.dek = null
    this.data = null
    this.digest = null
    if (emit) this.ctx.emit(this, 'vault/lock')
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    return this.serialize(() => this.withFileLock(() => this.doChangePassword(oldPassword, newPassword)))
  }

  private async doChangePassword(oldPassword: string, newPassword: string): Promise<void> {
    const { file, content } = await this.readFile()
    // 与 persistData() 相同的一致性检查：改密码前确认文件没有被其他进程改过
    if (this.digest && fileDigest(content) !== this.digest) throw new VaultConflictError()
    const oldKek = deriveKey(oldPassword, file.kdf)
    let dek: Buffer
    try {
      dek = unseal(file.wrapped, oldKek, AAD_DEK)
    } catch {
      throw new InvalidPasswordError()
    } finally {
      oldKek.fill(0)
    }

    const kdf = createKdfParams()
    const newKek = deriveKey(newPassword, kdf)
    try {
      file.kdf = kdf
      file.wrapped = seal(dek, newKek, AAD_DEK)
      file.meta.updatedAt = new Date().toISOString()
    } finally {
      newKek.fill(0)
      // 已解锁时保留内存中的 DEK；否则擦除临时副本
      if (this.dek !== dek) dek.fill(0)
    }
    await this.persist(file)
    this.digest = fileDigest(JSON.stringify(file, null, 2))
  }

  list(filter: ListFilter = {}): Entry[] {
    const data = this.assertUnlocked()
    let entries = data.entries
    if (filter.category) entries = entries.filter(entry => entryCategory(entry) === filter.category)
    if (filter.uncategorized) entries = entries.filter(entry => !entryCategory(entry))
    if (filter.query) {
      const query = filter.query.toLowerCase()
      entries = entries.filter(entry => haystack(entry).includes(query))
    }
    return clone([...entries].sort((a, b) => a.title.localeCompare(b.title, localeTag())))
  }

  getById(id: string): Entry | undefined {
    const entry = this.assertUnlocked().entries.find(item => item.id === id)
    return entry && clone(entry)
  }

  /** 把用户输入解析为唯一条目：优先 id，其次标题精确匹配，最后模糊匹配 */
  resolve(query: string): Entry {
    const data = this.assertUnlocked()
    const byId = data.entries.find(entry => entry.id === query)
    if (byId) return clone(byId)

    const byTitle = data.entries.filter(entry => entry.title.toLowerCase() === query.toLowerCase())
    if (byTitle.length === 1) return clone(byTitle[0]!)

    const matches = data.entries.filter(entry => haystack(entry).includes(query.toLowerCase()))
    if (matches.length === 1) return clone(matches[0]!)
    if (!matches.length) throw new VaultNotFoundError(t('common.errors.notFoundQuery', { query }))
    throw new VaultAmbiguousError(query, clone(matches))
  }

  async add(input: EntryInput): Promise<Entry> {
    return this.serialize(() => this.withFileLock(async () => {
      const draft = this.draft()
      const now = new Date().toISOString()
      const entry: Entry = {
        id: input.id ?? newEntryId(),
        title: input.title.trim(),
        createdAt: input.createdAt ?? now,
        updatedAt: now,
      }
      if (input.username) entry.username = input.username
      if (input.password) entry.password = input.password
      const extra = normalizeExtra(input.extra)
      if (extra) entry.extra = extra
      this.rememberCategory(draft, entryCategory(entry))

      draft.entries.push(entry)
      await this.persistData(draft)
      this.data = draft
      this.ctx.emit(this, 'vault/change', 'add', clone(entry))
      return clone(entry)
    }))
  }

  async update(id: string, patch: EntryPatch): Promise<Entry> {
    return this.serialize(() => this.withFileLock(async () => {
      const draft = this.draft()
      const entry = draft.entries.find(item => item.id === id)
      if (!entry) throw new VaultNotFoundError(t('common.errors.notFoundId', { id }))

      if (patch.title !== undefined && !patch.title.trim()) throw new VaultError(t('common.errors.titleRequired'))

      if (patch.title !== undefined) entry.title = patch.title.trim()
      for (const key of ['username', 'password'] as const) {
        if (!(key in patch)) continue
        const value = patch[key]
        if (value === undefined || value === '') delete entry[key]
        else entry[key] = value
      }
      if (patch.extra) {
        const extra = { ...entry.extra }
        for (const [key, value] of Object.entries(patch.extra)) {
          const name = key.trim()
          if (!name) continue
          if (value === undefined || value === null || value === '') delete extra[name]
          else extra[name] = String(value)
        }
        if (Object.keys(extra).length) entry.extra = extra
        else delete entry.extra
        this.rememberCategory(draft, entryCategory(entry))
      }
      entry.updatedAt = new Date().toISOString()

      await this.persistData(draft)
      this.data = draft
      this.ctx.emit(this, 'vault/change', 'update', clone(entry))
      return clone(entry)
    }))
  }

  async remove(id: string): Promise<Entry> {
    return this.serialize(() => this.withFileLock(async () => {
      const draft = this.draft()
      const index = draft.entries.findIndex(item => item.id === id)
      if (index === -1) throw new VaultNotFoundError(t('common.errors.notFoundId', { id }))
      const [entry] = draft.entries.splice(index, 1)

      await this.persistData(draft)
      this.data = draft
      this.ctx.emit(this, 'vault/change', 'remove', clone(entry!))
      return clone(entry!)
    }))
  }

  async import(inputs: EntryInput[], options: ImportOptions = {}): Promise<ImportResult> {
    return this.serialize(() => this.withFileLock(async () => {
      const draft = this.draft()
      const skipDuplicates = options.skipDuplicates ?? true
      let imported = 0
      let skipped = 0
      const now = new Date().toISOString()

      for (const input of inputs) {
        const extra = normalizeExtra(input.extra)
        const category = extra?.category
        if (skipDuplicates && draft.entries.some(entry =>
          entry.title === input.title
          && entryCategory(entry) === category
          && (entry.username ?? '') === (input.username ?? ''))) {
          skipped++
          continue
        }
        const entry: Entry = {
          id: newEntryId(),
          title: input.title.trim(),
          createdAt: input.createdAt ?? now,
          updatedAt: now,
        }
        if (input.username) entry.username = input.username
        if (input.password) entry.password = input.password
        if (extra) entry.extra = extra
        this.rememberCategory(draft, entryCategory(entry))
        draft.entries.push(entry)
        imported++
      }

      if (imported) {
        await this.persistData(draft)
        this.data = draft
      }
      this.ctx.emit(this, 'vault/change', 'import')
      return { imported, skipped }
    }))
  }

  parseImport(content: string, format: 'json' | 'csv'): EntryInput[] {
    return format === 'csv' ? parseImportCSV(content) : parseImportJSON(content)
  }

  export(format: 'json' | 'csv'): string {
    const data = this.assertUnlocked()
    return format === 'csv' ? exportCSV(data.entries) : exportJSON(data)
  }

  /**
   * 导出加密副本：直接返回保险库文件内容（本身即 pmvault 加密格式）。
   * 无需解锁 —— 所有修改都即时落盘，文件就是唯一事实来源。
   */
  async exportBackup(): Promise<string> {
    return this.readContent()
  }

  stats(): { total: number; byCategory: Record<string, number>; uncategorized: number } {
    const data = this.assertUnlocked()
    const byCategory: Record<string, number> = {}
    let uncategorized = 0
    for (const entry of data.entries) {
      const category = entryCategory(entry)
      if (category) byCategory[category] = (byCategory[category] ?? 0) + 1
      else uncategorized++
    }
    return { total: data.entries.length, byCategory, uncategorized }
  }

  private assertUnlocked(): VaultData {
    if (!this.dek || !this.data) throw new VaultLockedError()
    return this.data
  }

  private async readContent(): Promise<string> {
    try {
      return await fs.promises.readFile(this.config.file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new VaultNotFoundError(t('common.errors.vaultMissing', { file: this.config.file }))
      }
      throw error
    }
  }

  private async readFile(): Promise<{ file: VaultFile; content: string }> {
    const content = await this.readContent()
    return { file: parseVaultFile(content, this.config.file), content }
  }

  private async persist(file: VaultFile): Promise<void> {
    const target = this.config.file
    const dir = path.dirname(target)
    await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 })
    // 目录已存在时 mkdir 不会改权限，补一次（Windows 上会失败，忽略）
    await fs.promises.chmod(dir, 0o700).catch(() => {})

    const content = JSON.stringify(file, null, 2)
    const tmp = `${target}.${process.pid}.tmp`
    await fs.promises.writeFile(tmp, content, { mode: 0o600 })
    if (this.exists()) {
      // 覆盖前留一份备份
      await fs.promises.copyFile(target, `${target}.bak`).catch(() => {})
    }
    await fs.promises.rename(tmp, target)
    await fs.promises.chmod(target, 0o600).catch(() => {})
  }
}

/**
 * 轻量探测一段内容是否为保险库文件（pmvault 格式）。
 * 只做宽松检查：KDF 等严格校验交给 parseVaultFile 报精确错误，
 * 避免恶意参数在探测阶段就抛异常。
 */
export function isVaultFileContent(content: string): boolean {
  try {
    const parsed = JSON.parse(content)
    return parsed?.format === 'pmvault'
      && (parsed.version === 1 || parsed.version === 2)
      && !!parsed.wrapped && !!parsed.vault
  } catch {
    return false
  }
}

/** 用指定主密码解密一份保险库文件内容（用于导入加密备份），不改动当前会话状态 */
export function decryptVaultFile(content: string, password: string): VaultData {
  const file = parseVaultFile(content, t('common.errors.backupSource'))
  const kek = deriveKey(password, file.kdf)
  let dek: Buffer
  try {
    dek = unseal(file.wrapped, kek, AAD_DEK)
  } catch {
    throw new InvalidPasswordError()
  } finally {
    kek.fill(0)
  }
  let plaintext: Buffer
  try {
    plaintext = unseal(file.vault, dek, AAD_DATA)
  } catch {
    throw new VaultError(t('common.errors.backupIntegrity'))
  } finally {
    dek.fill(0)
  }
  try {
    return normalizeData(JSON.parse(plaintext.toString('utf8')))
  } catch (error) {
    throw new VaultError(t('common.errors.backupParse', { message: (error as Error).message }))
  } finally {
    plaintext.fill(0)
  }
}

/** 模糊匹配的范围：标题、用户名与全部 extra 键值（有意不含密码本身） */
function haystack(entry: Entry): string {
  return [
    entry.title,
    entry.username,
    ...Object.entries(entry.extra ?? {}).map(([key, value]) => `${key} ${value}`),
  ].filter((value): value is string => !!value).join('\n').toLowerCase()
}

/**
 * 归一化磁盘数据：
 * - v1 -> v2：把 category/url/notes/tags 折进 extra
 * - 清洗 extra 值、丢弃无标题的脏数据
 */
export function normalizeData(raw: any): VaultData {
  if (!raw || !Array.isArray(raw.entries)) throw new Error(t('common.errors.missingEntries'))
  const entries: Entry[] = raw.entries
    .filter((entry: any) => entry && typeof entry === 'object' && typeof entry.title === 'string')
    .map((entry: any): Entry => {
      const now = new Date().toISOString()
      const result: Entry = {
        id: typeof entry.id === 'string' ? entry.id : newEntryId(),
        title: entry.title,
        createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : now,
        updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : now,
      }
      for (const key of ['username', 'password'] as const) {
        if (typeof entry[key] === 'string' && entry[key]) result[key] = entry[key]
      }

      // extra 本身 + v1 遗留字段
      const extra: Record<string, string> = { ...normalizeExtra(entry.extra) }
      if (typeof entry.category === 'string' && entry.category) extra.category = entry.category
      if (typeof entry.url === 'string' && entry.url) extra.url = entry.url
      if (typeof entry.notes === 'string' && entry.notes) extra.notes = entry.notes
      if (Array.isArray(entry.tags) && entry.tags.length) extra.tags = entry.tags.map(String).filter(Boolean).join('|')
      else if (typeof entry.tags === 'string' && entry.tags) extra.tags = entry.tags
      const cleaned = normalizeExtra(extra)
      if (cleaned) result.extra = cleaned

      return result
    })

  const data: VaultData = { version: VAULT_VERSION, entries }
  // 保留用户登记的分类列表（去掉空值与重复）
  const clean = (value: unknown) => Array.isArray(value)
    ? [...new Set(value.map(item => String(item).trim()).filter(Boolean))]
    : []
  const categories = clean(raw.settings?.categories)
  const hidden = clean(raw.settings?.hidden)
  const settings: VaultSettings = {}
  if (categories.length) settings.categories = categories
  if (hidden.length) settings.hidden = hidden
  if (Object.keys(settings).length) data.settings = settings
  return data
}

export default Vault
