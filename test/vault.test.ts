import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from 'cordis'
import { setLocale } from '../src/i18n/index.ts'
import {
  InvalidPasswordError, Vault, VaultAmbiguousError, VaultConflictError,
  VaultError, VaultExistsError, VaultLockedError, VaultNotFoundError,
  decryptVaultFile, isVaultFileContent, normalizeData,
} from '../src/plugins/vault.ts'

// 下面有几处断言的错误文案：固定用中文，避免测试结果随运行环境的语言变化
setLocale('zh')

const PASSWORD = 'test-master-password'

let dir: string
before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-test-')) })
after(() => { fs.rmSync(dir, { recursive: true, force: true }) })

let counter = 0
function tmpFile(name?: string): string {
  return path.join(dir, name ?? `vault-${++counter}.json`)
}

async function openVault(file: string) {
  const ctx = new Context()
  await ctx.plugin(Vault, { file })
  return ctx
}

describe('Vault 基础', () => {
  it('创建、解锁、错误密码', async () => {
    const file = tmpFile()
    const ctx = await openVault(file)
    await ctx.vault.create(PASSWORD)

    assert.ok(ctx.vault.exists())
    assert.ok(ctx.vault.unlocked)

    const ctx2 = await openVault(file)
    assert.equal(ctx2.vault.unlocked, false)
    await assert.rejects(() => ctx2.vault.unlock('wrong-password'), InvalidPasswordError)

    await ctx2.vault.unlock(PASSWORD)
    assert.ok(ctx2.vault.unlocked)
  })

  it('数据目录不存在时自动创建（首次使用场景）', async () => {
    // 模拟 ~/.password-mgr 尚未创建：锁文件必须能先于数据文件落盘
    const file = path.join(dir, 'fresh', 'nested', 'vault.json')
    const ctx = await openVault(file)
    await ctx.vault.create(PASSWORD)
    assert.ok(fs.existsSync(file))
    await ctx.vault.add({ title: 'X' })

    const ctx2 = await openVault(file)
    await ctx2.vault.unlock(PASSWORD)
    assert.equal(ctx2.vault.count(), 1)
    assert.ok(!fs.existsSync(file + '.lock'), '锁文件应已释放')
  })

  it('重复创建需要 force', async () => {
    const file = tmpFile()
    const ctx = await openVault(file)
    await ctx.vault.create(PASSWORD)
    await assert.rejects(() => ctx.vault.create(PASSWORD), VaultExistsError)
  })

  it('文件不存在时给出明确错误', async () => {
    const ctx = await openVault(tmpFile('missing.json'))
    await assert.rejects(() => ctx.vault.unlock(PASSWORD), VaultNotFoundError)
  })

  it('未解锁时操作会被拒绝', async () => {
    const file = tmpFile()
    const creator = await openVault(file)
    await creator.vault.create(PASSWORD)

    const ctx = await openVault(file)
    assert.throws(() => ctx.vault.list(), VaultLockedError)
    await assert.rejects(() => ctx.vault.add({ title: 'x' }), VaultLockedError)
  })

  it('文件权限为 0600', async () => {
    const file = tmpFile()
    const ctx = await openVault(file)
    await ctx.vault.create(PASSWORD)
    const mode = fs.statSync(file).mode & 0o777
    assert.equal(mode, 0o600, `期望 0600，实际 ${mode.toString(8)}`)
  })

  it('落盘内容不含明文密码与标题', async () => {
    const file = tmpFile()
    const ctx = await openVault(file)
    await ctx.vault.create(PASSWORD)
    await ctx.vault.add({ title: 'SuperSecretSite', password: 'p@ssw0rd-plain', extra: { url: 'https://secret.example' } })

    const raw = fs.readFileSync(file, 'utf8')
    assert.ok(!raw.includes('SuperSecretSite'))
    assert.ok(!raw.includes('p@ssw0rd-plain'))
    assert.ok(!raw.includes('secret.example'))
    assert.ok(!raw.includes(PASSWORD))
    assert.equal(JSON.parse(raw).format, 'pmvault')
    assert.equal(JSON.parse(raw).version, 2)
  })
})

describe('Vault 增删改查', () => {
  it('CRUD 全流程并持久化', async () => {
    const file = tmpFile()
    const ctx = await openVault(file)
    await ctx.vault.create(PASSWORD)

    const github = await ctx.vault.add({
      title: 'GitHub', username: 'me', password: 'gh-secret',
      extra: { category: 'website', url: 'https://github.com', tags: 'dev' },
    })
    await ctx.vault.add({ title: 'Gmail', username: 'me@gmail.com', password: 'gw', extra: { category: 'email' } })
    await ctx.vault.add({ title: 'OpenAI', password: 'sk-x', extra: { category: 'apikey' } })
    await ctx.vault.add({ title: '无分类条目' })

    assert.equal(ctx.vault.count(), 4)
    assert.equal(ctx.vault.count('website'), 1)
    // 分类统计是动态的：只列出实际用到的分类
    assert.deepEqual(ctx.vault.stats(), {
      total: 4,
      byCategory: { website: 1, email: 1, apikey: 1 },
      uncategorized: 1,
    })

    // 分类过滤与关键词搜索（搜索覆盖 extra 键值）
    assert.deepEqual(ctx.vault.list({ category: 'email' }).map(e => e.title), ['Gmail'])
    assert.deepEqual(ctx.vault.list({ uncategorized: true }).map(e => e.title), ['无分类条目'])
    assert.deepEqual(ctx.vault.list({ query: 'gmail' }).map(e => e.title), ['Gmail'])
    assert.deepEqual(ctx.vault.list({ query: 'github.com' }).map(e => e.title), ['GitHub'])

    // 更新核心字段与 extra
    const updated = await ctx.vault.update(github.id, {
      password: 'gh-secret-v2',
      extra: { notes: '工作' },
    })
    assert.equal(updated.password, 'gh-secret-v2')
    assert.equal(updated.extra!.notes, '工作')
    assert.equal(updated.extra!.url, 'https://github.com', '其他 extra 键保持不变')
    assert.notEqual(updated.updatedAt, github.updatedAt)

    // 空串删除 extra 键
    const cleared = await ctx.vault.update(github.id, { extra: { notes: '' } })
    assert.equal(cleared.extra!.notes, undefined)
    assert.equal(cleared.extra!.url, 'https://github.com')

    // 空标题会被拒绝，且不污染内存状态
    await assert.rejects(() => ctx.vault.update(github.id, { title: '  ' }), VaultError)
    assert.equal(ctx.vault.getById(github.id)!.title, 'GitHub')

    // 重新打开验证持久化
    const ctx2 = await openVault(file)
    await ctx2.vault.unlock(PASSWORD)
    assert.equal(ctx2.vault.count(), 4)
    assert.equal(ctx2.vault.getById(github.id)!.password, 'gh-secret-v2')
    assert.equal(ctx2.vault.getById(github.id)!.extra!.url, 'https://github.com')

    // 删除
    await ctx2.vault.remove(github.id)
    assert.equal(ctx2.vault.count(), 3)
    await assert.rejects(() => ctx2.vault.remove(github.id), VaultNotFoundError)
  })

  it('任意 extra 键都能存取', async () => {
    const file = tmpFile()
    const ctx = await openVault(file)
    await ctx.vault.create(PASSWORD)
    const entry = await ctx.vault.add({
      title: '腾讯云',
      username: 'AKIDxxx',
      password: 'secret-key',
      extra: { category: 'apikey', SecretId: 'AKIDxxx', 环境: '生产', 到期: '2027-01' },
    })
    assert.equal(entry.extra!.SecretId, 'AKIDxxx')
    assert.equal(entry.extra!.环境, '生产')

    const ctx2 = await openVault(file)
    await ctx2.vault.unlock(PASSWORD)
    const reloaded = ctx2.vault.resolve('腾讯云')
    assert.equal(reloaded.extra!.到期, '2027-01')
  })

  it('resolve：精确 id / 标题 / 模糊 / 歧义 / 未找到', async () => {
    const file = tmpFile()
    const ctx = await openVault(file)
    await ctx.vault.create(PASSWORD)
    const a = await ctx.vault.add({ title: 'Bank', username: 'alice' })
    await ctx.vault.add({ title: '银行', username: 'bob' })

    assert.equal(ctx.vault.resolve(a.id).id, a.id)
    assert.equal(ctx.vault.resolve('Bank').id, a.id)
    assert.equal(ctx.vault.resolve('bob').title, '银行')
    assert.throws(() => ctx.vault.resolve('nothing-matches'), VaultNotFoundError)

    await ctx.vault.add({ title: 'Bank备用', username: 'carol' })
    assert.equal(ctx.vault.resolve('bank').id, a.id)
    assert.throws(() => ctx.vault.resolve('ank'), VaultAmbiguousError)
  })

  it('返回的条目是副本，外部修改不影响内部状态', async () => {
    const file = tmpFile()
    const ctx = await openVault(file)
    await ctx.vault.create(PASSWORD)
    const entry = await ctx.vault.add({ title: 'X', password: 'p', extra: { notes: 'n' } })

    entry.title = '被改坏了'
    entry.password = 'hacked'
    entry.extra!.notes = 'hacked'
    assert.equal(ctx.vault.getById(entry.id)!.title, 'X')
    assert.equal(ctx.vault.getById(entry.id)!.password, 'p')
    assert.equal(ctx.vault.getById(entry.id)!.extra!.notes, 'n')
  })
})

describe('Vault 主密码与完整性', () => {
  it('修改主密码后旧密码失效、数据保留', async () => {
    const file = tmpFile()
    const ctx = await openVault(file)
    await ctx.vault.create(PASSWORD)
    await ctx.vault.add({ title: 'Stripe', password: 'sk_live_x', extra: { category: 'apikey' } })

    await ctx.vault.changePassword(PASSWORD, 'brand-new-password')

    const ctx2 = await openVault(file)
    await assert.rejects(() => ctx2.vault.unlock(PASSWORD), InvalidPasswordError)
    await ctx2.vault.unlock('brand-new-password')
    assert.equal(ctx2.vault.list()[0]!.password, 'sk_live_x')
  })

  it('旧主密码错误时不会改动文件', async () => {
    const file = tmpFile()
    const ctx = await openVault(file)
    await ctx.vault.create(PASSWORD)
    const before = fs.readFileSync(file, 'utf8')
    await assert.rejects(() => ctx.vault.changePassword('wrong', 'another-password'), InvalidPasswordError)
    assert.equal(fs.readFileSync(file, 'utf8'), before)
  })

  it('密文被篡改时拒绝解密', async () => {
    const file = tmpFile()
    const ctx = await openVault(file)
    await ctx.vault.create(PASSWORD)
    await ctx.vault.add({ title: 'X' })

    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    const bytes = Buffer.from(data.vault.data, 'base64')
    bytes[5] = bytes[5]! ^ 0xff
    data.vault.data = bytes.toString('base64')
    fs.writeFileSync(file, JSON.stringify(data))

    const ctx2 = await openVault(file)
    await assert.rejects(() => ctx2.vault.unlock(PASSWORD), VaultError)
  })

  it('文件被其他进程改写后保存会报冲突', async () => {
    const fileA = tmpFile()
    const fileB = tmpFile()

    const a = await openVault(fileA)
    await a.vault.create(PASSWORD)
    await a.vault.add({ title: 'A' })

    const b = await openVault(fileB)
    await b.vault.create(PASSWORD)
    await b.vault.add({ title: 'B' })
    fs.copyFileSync(fileB, fileA)

    await assert.rejects(() => a.vault.add({ title: 'C' }), VaultConflictError)
  })

  it('保存失败不会在内存里留下幽灵条目', async () => {
    const fileA = tmpFile()
    const fileB = tmpFile()

    const a = await openVault(fileA)
    await a.vault.create(PASSWORD)
    const b = await openVault(fileB)
    await b.vault.create(PASSWORD)
    await b.vault.add({ title: 'B' })

    fs.copyFileSync(fileB, fileA)

    await assert.rejects(() => a.vault.add({ title: 'PHANTOM' }), VaultConflictError)
    assert.equal(a.vault.count(), 0, '失败的写入不应出现在内存状态里')

    await assert.rejects(() => a.vault.add({ title: 'AGAIN' }), VaultConflictError)
    assert.equal(a.vault.count(), 0)
    assert.deepEqual(a.vault.list(), [])
  })

  it('两个进程并发写入时不会静默丢数据', async () => {
    const file = tmpFile()
    const a = await openVault(file)
    await a.vault.create(PASSWORD)
    await a.vault.add({ title: 'base' })

    const b = await openVault(file)
    await b.vault.unlock(PASSWORD)

    const results = await Promise.allSettled([
      a.vault.add({ title: 'from-A' }),
      b.vault.add({ title: 'from-B' }),
    ])
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1, '应当恰好一个成功')
    assert.equal(results.filter(r => r.status === 'rejected').length, 1, '另一个必须报冲突')

    const c = await openVault(file)
    await c.vault.unlock(PASSWORD)
    const titles = c.vault.list().map(entry => entry.title).sort()
    assert.equal(titles.length, 2)
    assert.ok(titles.includes('base'))
    assert.ok(titles.includes('from-A') || titles.includes('from-B'))
  })

  it('拒绝异常的 KDF 参数', async () => {
    const file = tmpFile()
    const ctx = await openVault(file)
    await ctx.vault.create(PASSWORD)

    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    data.kdf.N = 1 << 24 // 会让 scrypt 申请数 GB 内存
    fs.writeFileSync(file, JSON.stringify(data))

    const ctx2 = await openVault(file)
    await assert.rejects(() => ctx2.vault.unlock(PASSWORD), /scrypt/)
  })

  it('覆盖保存前会留一份 .bak 备份', async () => {
    const file = tmpFile()
    const ctx = await openVault(file)
    await ctx.vault.create(PASSWORD)
    const first = fs.readFileSync(file, 'utf8')
    await ctx.vault.add({ title: 'X' })

    assert.ok(fs.existsSync(file + '.bak'))
    assert.equal(fs.readFileSync(file + '.bak', 'utf8'), first)
  })
})

describe('Vault 导入导出', () => {
  it('JSON 与 CSV 往返', async () => {
    const file = tmpFile()
    const ctx = await openVault(file)
    await ctx.vault.create(PASSWORD)
    await ctx.vault.add({ title: 'Quote, Inc', password: 'p"quote', extra: { category: 'website' } })
    await ctx.vault.add({ title: '多行备注', extra: { notes: '第一行\n第二行', 自定义: '值' } })

    const json = ctx.vault.export('json')
    const csv = ctx.vault.export('csv')

    const ctx2 = await openVault(tmpFile())
    await ctx2.vault.create(PASSWORD)
    const fromJSON = await ctx2.vault.import(ctx2.vault.parseImport(json, 'json'), { skipDuplicates: false })
    assert.equal(fromJSON.imported, 2)
    assert.equal(ctx2.vault.resolve('Quote, Inc').password, 'p"quote')

    const ctx3 = await openVault(tmpFile())
    await ctx3.vault.create(PASSWORD)
    const fromCSV = await ctx3.vault.import(ctx3.vault.parseImport(csv, 'csv'))
    assert.equal(fromCSV.imported, 2)
    assert.equal(ctx3.vault.resolve('多行备注').extra!.notes, '第一行\n第二行')
    assert.equal(ctx3.vault.resolve('多行备注').extra!.自定义, '值')
  })

  it('默认跳过重复条目', async () => {
    const file = tmpFile()
    const ctx = await openVault(file)
    await ctx.vault.create(PASSWORD)
    await ctx.vault.add({ title: 'Dup', username: 'u', extra: { category: 'website' } })

    const exported = ctx.vault.export('json')
    const result = await ctx.vault.import(ctx.vault.parseImport(exported, 'json'))
    assert.deepEqual(result, { imported: 0, skipped: 1 })

    const forced = await ctx.vault.import(ctx.vault.parseImport(exported, 'json'), { skipDuplicates: false })
    assert.deepEqual(forced, { imported: 1, skipped: 0 })
    assert.equal(ctx.vault.count(), 2)
  })
})

describe('自定义分类', () => {
  it('任意分类名都能直接用，并自动登记', async () => {
    const file = tmpFile()
    const ctx = await openVault(file)
    await ctx.vault.create(PASSWORD)

    await ctx.vault.add({ title: '服务器 A', extra: { category: '服务器' } })
    await ctx.vault.add({ title: '工作邮箱', extra: { category: 'email' } })

    const categories = ctx.vault.categories()
    assert.deepEqual(categories.slice(0, 4), ['email', 'apikey', 'website', 'other'], '内置分类排在最前')
    assert.ok(categories.includes('服务器'))
    assert.equal(ctx.vault.count('服务器'), 1)
    assert.deepEqual(ctx.vault.list({ category: '服务器' }).map(e => e.title), ['服务器 A'])
    assert.deepEqual(ctx.vault.stats().byCategory, { 服务器: 1, email: 1 })

    // 重新打开后自定义分类仍在
    const ctx2 = await openVault(file)
    await ctx2.vault.unlock(PASSWORD)
    assert.ok(ctx2.vault.categories().includes('服务器'))
  })

  it('显式登记的分类在没有条目时也保留', async () => {
    const file = tmpFile()
    const ctx = await openVault(file)
    await ctx.vault.create(PASSWORD)
    await ctx.vault.registerCategory('待整理')
    assert.ok(ctx.vault.categories().includes('待整理'))

    const ctx2 = await openVault(file)
    await ctx2.vault.unlock(PASSWORD)
    assert.deepEqual(ctx2.vault.categories(), ['email', 'apikey', 'website', 'other', '待整理'])

    // 内置分类重复登记不会产生副本
    await ctx2.vault.registerCategory('邮箱')
    assert.equal(ctx2.vault.categories().filter(c => c === 'email').length, 1)
  })

  it('重命名分类会更新条目与登记列表', async () => {
    const file = tmpFile()
    const ctx = await openVault(file)
    await ctx.vault.create(PASSWORD)
    await ctx.vault.add({ title: 'A', extra: { category: '工作' } })
    await ctx.vault.add({ title: 'B', extra: { category: '工作' } })
    await ctx.vault.add({ title: 'C', extra: { category: '其他' } })

    const result = await ctx.vault.renameCategory('工作', '公司')
    assert.equal(result.entries, 2)
    assert.equal(ctx.vault.count('公司'), 2)
    assert.equal(ctx.vault.count('工作'), 0)
    assert.ok(ctx.vault.categories().includes('公司'))
    assert.ok(!ctx.vault.categories().includes('工作'))

    const ctx2 = await openVault(file)
    await ctx2.vault.unlock(PASSWORD)
    assert.equal(ctx2.vault.count('公司'), 2)
  })

  it('删除分类会让相关条目变成未分类；内置分类可移除并恢复', async () => {
    const file = tmpFile()
    const ctx = await openVault(file)
    await ctx.vault.create(PASSWORD)
    await ctx.vault.add({ title: 'A', extra: { category: '临时' } })
    await ctx.vault.add({ title: 'B', extra: { category: 'website' } })

    // 自定义分类：直接移除
    const result = await ctx.vault.deleteCategory('临时')
    assert.equal(result.entries, 1)
    assert.equal(ctx.vault.getById(ctx.vault.resolve('A').id)!.extra?.category, undefined)
    assert.ok(!ctx.vault.categories().includes('临时'))

    // 内置分类：移除即隐藏，相关条目变未分类，但条目本身保留
    const builtin = await ctx.vault.deleteCategory('website')
    assert.equal(builtin.entries, 1)
    assert.ok(!ctx.vault.categories().includes('website'))
    assert.equal(ctx.vault.stats().uncategorized, 2)
    assert.equal(ctx.vault.count(), 2)

    // 重新添加同名分类即恢复
    await ctx.vault.registerCategory('website')
    assert.ok(ctx.vault.categories().includes('website'))

    const ctx2 = await openVault(file)
    await ctx2.vault.unlock(PASSWORD)
    assert.ok(!ctx2.vault.categories().includes('临时'))
    assert.ok(ctx2.vault.categories().includes('website'))
    assert.equal(ctx2.vault.stats().uncategorized, 2)
  })

  it('重命名内置分类后原分类不再显示', async () => {
    const file = tmpFile()
    const ctx = await openVault(file)
    await ctx.vault.create(PASSWORD)
    await ctx.vault.add({ title: 'A', extra: { category: 'email' } })

    await ctx.vault.renameCategory('email', '工作邮箱')
    assert.ok(!ctx.vault.categories().includes('email'), '原内置分类应被移除')
    assert.ok(ctx.vault.categories().includes('工作邮箱'))
    assert.equal(ctx.vault.count('工作邮箱'), 1)
  })
})

describe('旧格式（v1）迁移', () => {
  it('category/url/notes/tags 会折进 extra', () => {
    const data = normalizeData({
      version: 1,
      entries: [{
        id: 'old-1',
        category: 'website',
        title: '旧条目',
        username: 'u',
        password: 'p',
        url: 'https://old.test',
        notes: '旧备注',
        tags: ['a', 'b'],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      }],
    })
    assert.equal(data.version, 2)
    const entry = data.entries[0]!
    assert.equal(entry.extra!.category, 'website')
    assert.equal(entry.extra!.url, 'https://old.test')
    assert.equal(entry.extra!.notes, '旧备注')
    assert.equal(entry.extra!.tags, 'a|b')
    assert.equal('category' in entry, false, '旧字段不应留在条目顶层')
  })

  it('脏数据被清洗：缺标题的条目丢弃，空 extra 值剔除', () => {
    const data = normalizeData({
      entries: [
        { title: 'ok', extra: { a: '1', b: '', c: null, d: ['x', 'y'] } },
        { username: '没有标题' },
      ],
    })
    assert.equal(data.entries.length, 1)
    assert.deepEqual(data.entries[0]!.extra, { a: '1', d: 'x|y' })
  })
})

describe('加密导出与导回', () => {
  it('导出的加密副本就是保险库文件，可直接作为保险库打开', async () => {
    const file = tmpFile()
    const ctx = await openVault(file)
    await ctx.vault.create(PASSWORD)
    await ctx.vault.add({ title: 'GitHub', username: 'me', password: 'gh-secret', extra: { category: 'website' } })
    await ctx.vault.add({ title: '多行备注', extra: { notes: '第一行\n第二行' } })

    const content = await ctx.vault.exportBackup()
    assert.equal(content, fs.readFileSync(file, 'utf8'), '加密副本应与保险库文件字节一致')
    assert.equal(isVaultFileContent(content), true)

    const copy = tmpFile('backup.pmv')
    fs.writeFileSync(copy, content)
    const ctx2 = await openVault(copy)
    await ctx2.vault.unlock(PASSWORD)
    assert.equal(ctx2.vault.count(), 2)
    assert.equal(ctx2.vault.resolve('GitHub').password, 'gh-secret')
    assert.equal(ctx2.vault.resolve('多行备注').extra!.notes, '第一行\n第二行')
  })

  it('保险库不存在时导出报 VaultNotFoundError', async () => {
    const ctx = await openVault(tmpFile('missing.json'))
    await assert.rejects(() => ctx.vault.exportBackup(), VaultNotFoundError)
  })

  it('解密备份：正确密码返回数据，错误密码 / 篡改 / 非法 KDF 都报错', async () => {
    const file = tmpFile()
    const ctx = await openVault(file)
    await ctx.vault.create(PASSWORD)
    await ctx.vault.add({ title: 'A', username: 'u', password: 'p', extra: { category: '服务器' } })
    await ctx.vault.registerCategory('待整理')

    const content = await ctx.vault.exportBackup()
    const data = decryptVaultFile(content, PASSWORD)
    assert.deepEqual(data.entries.map(entry => entry.title), ['A'])
    assert.ok(data.settings?.categories?.includes('待整理'), '登记的空分类也应随文件保留')

    assert.throws(() => decryptVaultFile(content, 'wrong-password'), InvalidPasswordError)

    const tampered = JSON.parse(content)
    const bytes = Buffer.from(tampered.vault.data, 'base64')
    bytes[3] = bytes[3]! ^ 0xff
    tampered.vault.data = bytes.toString('base64')
    assert.throws(() => decryptVaultFile(JSON.stringify(tampered), PASSWORD), (error: unknown) =>
      error instanceof VaultError && !(error instanceof InvalidPasswordError))

    const badKdf = JSON.parse(content)
    badKdf.kdf.N = 1 << 24 // 会让 scrypt 申请数 GB 内存
    assert.throws(() => decryptVaultFile(JSON.stringify(badKdf), PASSWORD), /scrypt/)

    assert.throws(() => decryptVaultFile('not json', PASSWORD), /不是合法的 JSON/)
    assert.throws(() => decryptVaultFile('{"format":"pmvault"}', PASSWORD), /无法识别的保险库文件格式/)
  })

  it('isVaultFileContent 只认保险库文件，不误判明文导出', async () => {
    const file = tmpFile()
    const ctx = await openVault(file)
    await ctx.vault.create(PASSWORD)
    await ctx.vault.add({ title: 'A' })

    assert.equal(isVaultFileContent(await ctx.vault.exportBackup()), true)
    assert.equal(isVaultFileContent(ctx.vault.export('json')), false)
    assert.equal(isVaultFileContent(ctx.vault.export('csv')), false)
    assert.equal(isVaultFileContent('not json'), false)
    assert.equal(isVaultFileContent(''), false)
    assert.equal(isVaultFileContent('[1,2,3]'), false)
  })

  it('导回：解密出的条目可合并进另一个保险库，默认跳过重复且保留创建时间', async () => {
    const source = await openVault(tmpFile())
    await source.vault.create(PASSWORD)
    const original = await source.vault.add({ title: 'A', username: 'u', password: 'p' })
    await source.vault.add({ title: 'B' })

    const backup = await source.vault.exportBackup()
    const entries = decryptVaultFile(backup, PASSWORD).entries

    const target = await openVault(tmpFile())
    await target.vault.create('other-master-password')
    assert.deepEqual(await target.vault.import(entries), { imported: 2, skipped: 0 })
    assert.deepEqual(await target.vault.import(entries), { imported: 0, skipped: 2 })
    assert.equal(target.vault.resolve('A').password, 'p')
    assert.equal(target.vault.resolve('A').createdAt, original.createdAt)
  })
})
