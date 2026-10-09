/**
 * 本地 Web UI 插件：在 127.0.0.1 上提供网页界面。
 *
 * 安全设计（仅限本机使用）：
 * - 只监听回环地址；绑定其他地址时 CLI 会二次确认
 * - 启动时生成一次性访问令牌；页面壳不含数据，可直接打开以便同一标签页刷新
 * - 所有 /api 请求必须携带 X-Vault-Token（或 ?token=），不使用 Cookie
 * - 校验 Host / Origin / Sec-Fetch-Site，阻断 DNS rebinding、其他端口与跨站请求
 * - 主密码只在 POST /api/unlock 中出现一次；DEK 仅保存在服务进程内存里
 * - 无操作自动锁定（默认 10 分钟）
 */
import { Context, Service } from 'cordis'
import z from 'schemastery'
import { spawn } from 'node:child_process'
import { timingSafeEqual } from 'node:crypto'
import { generatePassword, randomToken } from '../crypto.ts'
import { currentLocale, localeTag, normalizeLocale, setLocale, t } from '../i18n/index.ts'
import type { EntryInput } from '../types.ts'
import { CATEGORY_KEY, NOTES_KEY, TAGS_KEY, URL_KEY, isBuiltinCategory, parseCategory } from '../types.ts'
import { color } from '../utils/format.ts'
import { renderUI } from '../web/ui.ts'
import { VaultError, decryptVaultFile, isVaultFileContent, type EntryPatch, type Vault } from './vault.ts'

interface WebConfig {
  /** 无操作自动锁定时间（分钟），0 表示不自动锁定 */
  autoLockMinutes?: number
  /** 启动后自动打开浏览器 */
  open?: boolean
  /** 固定访问令牌（默认随机生成；一般无需设置） */
  token?: string
}

const Config: z<WebConfig> = z.object({
  autoLockMinutes: z.natural().default(10).description(t('web.server.config.autoLock')),
  open: z.boolean().default(false).description(t('web.server.config.open')),
  token: z.string().description(t('web.server.config.token')),
})

type Req = Parameters<Parameters<Context['server']['get']>[1]>[0]
type Res = Parameters<Parameters<Context['server']['get']>[1]>[1]

class WebUI extends Service<WebConfig> {
  static Config = Config
  static inject = ['server', 'vault']

  config: WebConfig

  private token = ''
  private timer: NodeJS.Timeout | undefined

  constructor(ctx: Context, config: WebConfig) {
    super(ctx, 'webui')
    this.config = config
  }

  private get vault(): Vault {
    return this.ctx.vault
  }

  *[Service.init]() {
    // 注意用 || 而非 ??：空字符串令牌会让空 token 通过校验
    this.token = this.config.token || randomToken()

    // 页面壳不含保险库数据，刷新时地址栏已无 token，因此不在这里校验令牌
    yield this.route('GET', '/', (_req, res) => {
      res.headers.set('content-type', 'text/html; charset=utf-8')
      res.headers.set('content-security-policy',
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'")
      res.headers.set('referrer-policy', 'no-referrer')
      res.body = renderUI({ autoLockMinutes: this.config.autoLockMinutes ?? 0, lang: currentLocale() })
    }, { htmlErrors: true, auth: false })

    // 状态查询是前端的保活轮询，不计入"用户操作"，否则自动锁定永远不会触发
    yield this.route('GET', '/api/status', (_req, res) => {
      const vault = this.vault
      const stats = vault.unlocked ? vault.stats() : null
      res.json({
        unlocked: vault.unlocked,
        total: stats?.total ?? 0,
        byCategory: stats?.byCategory ?? {},
        categories: vault.unlocked ? vault.categories().map(value => ({
          value,
          builtin: isBuiltinCategory(value),
          count: stats?.byCategory[value] ?? 0,
        })) : [],
        uncategorized: stats?.uncategorized ?? 0,
        autoLockMinutes: this.config.autoLockMinutes ?? 0,
        path: vault.path,
      })
    }, { touch: false })

    yield this.route('POST', '/api/unlock', async (req, res) => {
      const body = await readJSON(req)
      const password = typeof body?.password === 'string' ? body.password : ''
      if (!password) throw new VaultError(t('web.server.enterMasterPassword'))
      await this.vault.unlock(password)
      res.json({ unlocked: true, total: this.vault.count() })
    })

    yield this.route('POST', '/api/lock', (_req, res) => {
      this.vault.lock()
      res.json({ unlocked: false })
    })

    // 页面上的语言切换：改后端语言后，接口报错、刷新页面都会用新语言
    yield this.route('POST', '/api/lang', async (req, res) => {
      const body = await readJSON(req)
      const locale = typeof body?.lang === 'string' ? normalizeLocale(body.lang) : undefined
      if (locale) setLocale(locale)
      res.json({ lang: currentLocale() })
    })

    yield this.route('GET', '/api/entries', (req, res) => {
      this.assertUnlocked()
      const rawCategory = (req.query.get('category') ?? '').trim()
      const entries = this.vault.list({
        category: rawCategory || undefined,
        uncategorized: req.query.get('uncategorized') === 'true',
        query: req.query.get('query') ?? undefined,
      })
      // 列表不下发密码字段，需要时用 GET /api/entries/:id 获取
      res.json({ entries: entries.map(({ password, ...rest }) => ({ ...rest, hasPassword: !!password })) })
    })

    yield this.route('GET', '/api/entries/:id', (req, res) => {
      this.assertUnlocked()
      const entry = this.vault.getById(req.params.id)
      if (!entry) throw new VaultError(t('web.server.entryNotFound'))
      res.json({ entry })
    })

    yield this.route('POST', '/api/entries', async (req, res) => {
      this.assertUnlocked()
      const entry = await this.vault.add(parseCreate(await readJSON(req)))
      res.json({ entry })
    })

    yield this.route('PATCH', '/api/entries/:id', async (req, res) => {
      this.assertUnlocked()
      const entry = await this.vault.update(req.params.id, parsePatch(await readJSON(req)))
      res.json({ entry })
    })

    yield this.route('DELETE', '/api/entries/:id', async (req, res) => {
      this.assertUnlocked()
      await this.vault.remove(req.params.id)
      res.json({ ok: true })
    })

    yield this.route('POST', '/api/generate', async (req, res) => {
      const body = await readJSON(req)
      const length = Number(body?.length)
      res.json({
        password: generatePassword({
          length: Number.isFinite(length) ? Math.min(512, Math.max(4, Math.trunc(length))) : 20,
          lowercase: body?.lowercase !== false,
          uppercase: body?.uppercase !== false,
          digits: body?.digits !== false,
          symbols: body?.symbols !== false,
          excludeAmbiguous: body?.excludeAmbiguous === true,
        }),
      })
    })

    yield this.route('GET', '/api/export', async (req, res) => {
      this.assertUnlocked()
      const stamp = new Date().toISOString().slice(0, 10)
      res.status = 200
      // vault = 加密副本：就是保险库文件本身，与主密码相同
      if (req.query.get('format') === 'vault') {
        res.headers.set('content-type', 'application/json; charset=utf-8')
        res.headers.set('content-disposition', `attachment; filename="passwords-${stamp}.pmv"`)
        res.body = await this.vault.exportBackup()
        return
      }
      const format = req.query.get('format') === 'csv' ? 'csv' : 'json'
      res.headers.set('content-type', format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8')
      res.headers.set('content-disposition', `attachment; filename="passwords-${stamp}.${format}"`)
      res.body = this.vault.export(format)
    })

    yield this.route('POST', '/api/import', async (req, res) => {
      this.assertUnlocked()
      const body = await readJSON(req)
      const content = typeof body?.content === 'string' ? body.content : ''
      if (!content.trim()) throw new VaultError(t('web.server.importEmpty'))
      let inputs: EntryInput[]
      if (isVaultFileContent(content)) {
        // pmvault 加密备份：需要该文件的主密码
        const password = typeof body?.password === 'string' ? body.password : ''
        if (!password) throw new VaultError(t('web.server.backupPasswordRequired'))
        inputs = decryptVaultFile(content, password).entries
      } else {
        const format = body?.format === 'csv' ? 'csv' : 'json'
        inputs = this.vault.parseImport(content, format)
      }
      res.json(await this.vault.import(inputs, { skipDuplicates: body?.keepDuplicates !== true }))
    })

    // ------------------------------------------------------------ 分类管理
    yield this.route('POST', '/api/categories', async (req, res) => {
      this.assertUnlocked()
      const body = await readJSON(req)
      const name = typeof body?.name === 'string' ? body.name : ''
      const list = await this.vault.registerCategory(name)
      res.json({ categories: list })
    })

    yield this.route('PATCH', '/api/categories/:name', async (req, res) => {
      this.assertUnlocked()
      const body = await readJSON(req)
      const target = typeof body?.name === 'string' ? body.name : ''
      if (!target.trim()) throw new VaultError(t('web.server.newCategoryRequired'))
      const result = await this.vault.renameCategory(req.params.name, target)
      res.json(result)
    })

    yield this.route('DELETE', '/api/categories/:name', async (req, res) => {
      this.assertUnlocked()
      res.json(await this.vault.deleteCategory(req.params.name))
    })

    yield this.route('POST', '/api/password', async (req, res) => {
      const body = await readJSON(req)
      const oldPassword = typeof body?.oldPassword === 'string' ? body.oldPassword : ''
      const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : ''
      if (newPassword.length < 8) throw new VaultError(t('web.server.newPasswordTooShort'))
      await this.vault.changePassword(oldPassword, newPassword)
      res.json({ ok: true })
    })

    // 自动锁定：解锁时开始计时，锁定时取消
    yield this.ctx.on('vault/unlock', () => this.touch())
    yield this.ctx.on('vault/lock', () => this.stopTimer())
    yield () => this.stopTimer()

    const url = `http://127.0.0.1:${this.ctx.server.port}/?token=${this.token}`
    const minutes = this.config.autoLockMinutes ?? 0
    process.stderr.write(
      t('web.server.started', { check: color.green('✓'), url: color.bold(url) })
      + color.dim(minutes
        ? t('web.server.listenLoopbackAutoLock', { n: minutes })
        : t('web.server.listenLoopback'))
      + color.yellow(t('web.server.tokenWarn')))
    if (this.config.open) this.openBrowser(url)
  }

  /** 注册路由并返回 disposer（随本服务生命周期卸载） */
  private route(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    handler: (req: Req, res: Res) => Promise<void> | void,
    options: { touch?: boolean; htmlErrors?: boolean; auth?: boolean } = {},
  ): () => void {
    const callback = async (req: Req, res: Res) => {
      res.headers.set('cache-control', 'no-store')
      try {
        if (!this.checkOrigin(req)) return this.fail(res, 403, t('web.server.forbiddenOrigin'), options)
        if (options.auth ?? true) {
          const token = req.headers.get('x-vault-token') ?? req.query.get('token') ?? ''
          if (!this.checkToken(token)) {
            return this.fail(res, 401, t('web.server.invalidToken'), options)
          }
        }
        if (options.touch ?? true) this.touch()
        await handler(req, res)
      } catch (error) {
        if (error instanceof VaultError) return this.fail(res, 400, error.message, options)
        // 内部错误只写日志，不回显给客户端（可能含路径或解析上下文）
        this.ctx.logger?.error(error)
        this.fail(res, 500, t('web.server.internal'), options)
      }
    }

    const server = this.ctx.server
    const route =
      method === 'GET' ? server.get(path, callback)
      : method === 'POST' ? server.post(path, callback)
      : method === 'PATCH' ? server.patch(path, callback)
      : server.delete(path, callback)
    return () => route.dispose()
  }

  private fail(res: Res, status: number, message: string, options: { htmlErrors?: boolean } = {}) {
    res.status = status
    if (options.htmlErrors) {
      // 浏览器直接访问/刷新页面时给出可读的提示，而不是一坨 JSON
      res.headers.set('content-type', 'text/html; charset=utf-8')
      res.body = `<!doctype html><html lang="${localeTag()}"><meta charset="utf-8">`
        + `<meta name="viewport" content="width=device-width,initial-scale=1">`
        + `<title>${escapeHTML(t('web.brand'))}</title><body style="margin:0;display:grid;place-items:center;height:100vh;`
        + `background:#0d0f14;color:#e8eaf0;font:14px/1.7 -apple-system,'PingFang SC',system-ui,sans-serif">`
        + `<div style="max-width:460px;padding:32px;text-align:center">`
        + `<div style="font-size:34px">🔒</div><h1 style="font-size:18px;margin:12px 0 8px">${escapeHTML(t('web.server.pageTitle'))}</h1>`
        + `<p style="color:#9aa3b2;margin:0">${escapeHTML(message)}</p></div></body></html>`
      return
    }
    res.json({ message })
  }

  private checkToken(token: string): boolean {
    const expected = Buffer.from(this.token)
    const actual = Buffer.from(token)
    if (expected.length !== actual.length) return false
    return timingSafeEqual(expected, actual)
  }

  /**
   * 校验 Host / Origin / Sec-Fetch-Site，阻断 DNS rebinding、其他端口与跨站请求。
   * 仅监听回环地址时启用严格白名单；用户显式暴露到其他地址时（CLI 会二次确认）
   * 放行这些检查，但访问令牌仍然强制。
   * Cookie 不按端口隔离，因此不用 Cookie；来源必须精确到当前端口。
   */
  private checkOrigin(req: Req): boolean {
    const loopbackOnly = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(this.ctx.server.host)
    if (!loopbackOnly) return true

    const port = this.ctx.server.port
    const hostNames = ['127.0.0.1', 'localhost', '[::1]']
    const allowedHosts = new Set(hostNames.map(host => `${host}:${port}`))
    const allowedOrigins = new Set(hostNames.map(host => `http://${host}:${port}`))
    // 浏览器访问 80 端口时会省略 ":80"
    if (port === 80) {
      for (const host of hostNames) {
        allowedHosts.add(host)
        allowedOrigins.add(`http://${host}`)
      }
    }
    if (!allowedHosts.has(String(req.headers.get('host') ?? ''))) return false
    const origin = req.headers.get('origin')
    if (origin && !allowedOrigins.has(origin)) return false
    // 另一个端口是 same-site 而不是 same-origin；curl 不带这个头
    const site = req.headers.get('sec-fetch-site')
    if (site && site !== 'same-origin' && site !== 'none') return false
    return true
  }

  private assertUnlocked() {
    if (!this.vault.unlocked) throw new VaultError(t('web.server.locked'))
  }

  private touch() {
    this.stopTimer()
    const minutes = this.config.autoLockMinutes ?? 0
    if (!minutes || !this.vault.unlocked) return
    this.timer = setTimeout(() => {
      this.vault.lock()
      this.ctx.logger?.info(t('web.server.autoLocked'))
    }, minutes * 60_000)
  }

  private stopTimer() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }

  private openBrowser(url: string) {
    const [command, args]: [string, string[]] =
      process.platform === 'darwin' ? ['open', [url]]
      : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]]
    try {
      const child = spawn(command, args, { stdio: 'ignore', detached: true })
      // spawn 失败是异步的：没有 error 监听会让整个进程崩溃（如 Linux 上没有 xdg-open）
      child.on('error', () => {})
      child.unref()
    } catch {
      // 打不开浏览器不影响服务
    }
  }
}

function escapeHTML(text: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  return text.replace(/[&<>"']/g, char => map[char]!)
}

async function readJSON(req: Req): Promise<any> {
  try {
    return await req.json()
  } catch {
    throw new VaultError(t('web.server.badJson'))
  }
}

/** 请求体里的 extra：对象形式，值统一转字符串；也接受旧的顶层 category/url/notes/tags 写法 */
function parseExtra(body: any): Record<string, string> | undefined {
  const extra: Record<string, string> = {}
  if (body.extra && typeof body.extra === 'object') {
    for (const [key, value] of Object.entries(body.extra as Record<string, unknown>)) {
      const name = key.trim()
      if (!name) continue
      const text = Array.isArray(value) ? value.map(String).filter(Boolean).join('|') : String(value ?? '')
      if (text !== '') extra[name] = text
    }
  }
  const category = normalizeCategory(body.category)
  if (category) extra[CATEGORY_KEY] = category
  for (const key of [URL_KEY, NOTES_KEY] as const) {
    if (typeof body[key] === 'string' && body[key].trim()) extra[key] = body[key]
  }
  if (body.tags !== undefined) {
    const tags = Array.isArray(body.tags)
      ? body.tags.map(String).filter(Boolean).join('|')
      : String(body.tags).split(',').map((s: string) => s.trim()).filter(Boolean).join('|')
    if (tags) extra[TAGS_KEY] = tags
  }
  return Object.keys(extra).length ? extra : undefined
}

/** 新建条目：必须带标题 */
function parseCreate(body: any): EntryInput {
  if (!body || typeof body !== 'object') throw new VaultError(t('web.server.badFormat'))
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) throw new VaultError(t('web.server.titleRequired'))
  const input: EntryInput = { title }
  if (typeof body.username === 'string' && body.username) input.username = body.username
  if (typeof body.password === 'string' && body.password) input.password = body.password
  const extra = parseExtra(body)
  if (extra) input.extra = extra
  return input
}

/** 更新条目：只处理请求里出现的字段；extra 值为空串表示删除该键 */
function parsePatch(body: any): EntryPatch {
  if (!body || typeof body !== 'object') throw new VaultError(t('web.server.badFormat'))
  const patch: EntryPatch = {}
  if ('title' in body) patch.title = String(body.title ?? '').trim()
  for (const key of ['username', 'password'] as const) {
    if (key in body) patch[key] = String(body[key] ?? '')
  }
  const extra = parseExtra(body)
  // PATCH 里显式传空串的 extra 键要能删掉，所以这里单独收集
  if (body.extra && typeof body.extra === 'object') {
    const merged = { ...extra }
    for (const [key, value] of Object.entries(body.extra as Record<string, unknown>)) {
      const name = key.trim()
      if (name && String(value ?? '') === '') merged[name] = ''
    }
    if (Object.keys(merged).length) patch.extra = merged
  } else if (extra) {
    patch.extra = extra
  }
  return patch
}

/**
 * 归一化请求体里的分类：内置别名映射到规范值，其余作为自定义分类原样保留。
 * 返回 undefined 表示未分类。
 */
function normalizeCategory(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return parseCategory(value)
}

export default WebUI
