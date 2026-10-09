import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { translator, type MessageKey } from '../src/i18n/index.ts'
import { renderUI } from '../src/web/ui.ts'

const zh = renderUI({ autoLockMinutes: 10, lang: 'zh' })
const en = renderUI({ autoLockMinutes: 10, lang: 'en' })

function scriptOf(html: string): string {
  return html.split('<script>')[1]!.split('</script>')[0]!
}

describe('Web UI 内嵌脚本', () => {
  it('JS 语法合法（模板字符串转义、嵌入的文案 JSON 都在这里验证）', () => {
    for (const html of [zh, en]) {
      assert.doesNotThrow(
        () => new Function(scriptOf(html)),
        '内嵌 JS 解析失败：常见原因是 TS 模板字符串把 \\n 之类提前转义了，需要写成 \\\\n',
      )
    }
  })

  it('关键 DOM 钩子齐全', () => {
    const ids = [
      'unlock', 'master', 'unlock-btn', 'unlock-error', 'unlock-hint', 'status-text', 'status-pill',
      'app', 'search', 'categories', 'list', 'detail', 'add-btn', 'lock-btn',
      'entry-dialog', 'f-category', 'f-title', 'f-username', 'f-password', 'f-url',
      'f-notes', 'f-tags', 'f-extra', 'entry-save',
      'import-dialog', 'i-password', 'chpwd-dialog', 'toast',
      'export-dialog', 'export-json', 'export-csv', 'export-vault', 'export-cancel',
      'confirm-dialog', 'confirm-text', 'confirm-ok', 'confirm-cancel', 'confirm-input',
      'cat-actions', 'cat-add', 'cat-rename', 'cat-delete', 'category-options',
    ]
    for (const id of ids) assert.ok(zh.includes(`id="${id}"`), `缺少 #${id}`)
  })

  it('按所给语言渲染首屏，并带上双语目录与切换控件', () => {
    assert.ok(zh.includes('<html lang="zh-CN">'))
    assert.ok(en.includes('<html lang="en">'))
    assert.ok(zh.includes('解锁保险库') && zh.includes('未分类'))
    assert.ok(en.includes('Unlock the vault') && en.includes('Uncategorized'))
    assert.ok(zh.includes('var I18N =') && zh.includes('"zh"') && zh.includes('"en"'), '页面应内嵌两种语言的目录')
    assert.equal(zh.match(/class="lang-select"/g)?.length, 2, '解锁页与顶栏各应有一个语言切换器')
    assert.ok(zh.includes('data-i18n="web.unlock.title"'), '静态文案应带 data-i18n 供切换时重绘')
    assert.ok(zh.includes('data-i18n-html="web.exportDialog.warn"'))
    assert.ok(zh.includes('data-i18n-placeholder="web.sidebar.search"'))
    assert.ok(zh.includes('data-i18n-title="web.entry.togglePassword"'))
  })

  it('渲染出的分类列表包含未分类选项', () => {
    assert.ok(zh.includes('__none__'), '分类筛选需要支持未分类')
    assert.ok(zh.includes('未分类'))
    assert.ok(en.includes('Uncategorized'))
  })

  it('不引用任何外部资源（离线可用）', () => {
    assert.ok(!/\b(?:src|href)="https?:/.test(zh), '不应包含外部 URL 引用')
    assert.ok(!zh.includes('@import'))
    assert.ok(!zh.includes('http://') || !zh.includes('<link'), '不应外链样式')
  })

  it('不使用原生 confirm/alert（按钮语言不可控，且表达不了多选）', () => {
    const script = scriptOf(zh)
    assert.doesNotMatch(script, /(^|[^.\w])confirm\s*\(/, '应使用应用内弹窗而非原生 confirm')
    assert.doesNotMatch(script, /(^|[^.\w])alert\s*\(/, '应使用 toast 而非原生 alert')
  })

  it('条目可拖拽到分类（拖放钩子齐全）', () => {
    const script = scriptOf(zh)
    assert.ok(zh.includes('draggable="true"'), '列表项需要 draggable')
    for (const hook of ['dragstart', 'dragend', 'dragover', 'dragleave', 'drop']) {
      assert.ok(script.includes(`addEventListener('${hook}'`), `缺少 ${hook} 处理`)
    }
    assert.ok(zh.includes('drop-target'), '缺少拖放高亮样式')
  })

  it('自动锁定分钟数会按语言展示在解锁页', () => {
    assert.ok(renderUI({ autoLockMinutes: 15, lang: 'zh' }).includes('15 分钟'))
    assert.ok(renderUI({ autoLockMinutes: 15, lang: 'en' }).includes('15 minutes'))
    assert.ok(!renderUI({ autoLockMinutes: 0, lang: 'zh' }).includes('0 分钟'))
    assert.ok(!renderUI({ autoLockMinutes: 0, lang: 'en' }).includes('0 minutes'))
  })

  it('导出弹窗提供加密副本入口，导入支持 pmvault 文件与密码输入', () => {
    assert.ok(zh.includes('加密副本'), '缺少加密副本入口')
    assert.ok(zh.includes('accept=".json,.csv,.pmv,application/json,text/csv"'), '导入文件选择应支持 .pmv')
    assert.ok(en.includes('encrypted copy'), '英文界面同样要有加密副本入口')
  })

  it('搜索框禁用了 Safari 原生 searchfield 外观（修复双层聚焦环）', () => {
    assert.match(zh, /\.search\s*\{[^}]*-webkit-appearance:\s*none/)
    assert.match(zh, /\.search\s*\{[^}]*appearance:\s*none/)
  })

  it('页面里引用的每个词条在两种语言里都存在（拼错键名不会静默回退成键名）', () => {
    const keys = new Set<string>()
    for (const match of zh.matchAll(/data-i18n(?:-html|-placeholder|-title)?="([^"]+)"/g)) {
      keys.add(match[1]!)
    }
    for (const match of scriptOf(zh).matchAll(/(?<![\w.])t\('([^']+)'/g)) {
      const key = match[1]!
      if (!key.endsWith('.')) keys.add(key) // 'common.category.' + value 这类动态拼接跳过
    }
    assert.ok(keys.size > 40, '应当抽取到足量词条引用')
    for (const key of keys) {
      for (const lang of ['en', 'zh'] as const) {
        assert.notEqual(translator(lang)(key as MessageKey), key, `${lang} 缺少词条 ${key}`)
      }
    }
  })
})

// ---------------------------------------------------------------- 客户端 i18n 冒烟测试

class FakeElement {
  textContent = ''
  innerHTML = ''
  value = ''
  placeholder = ''
  title = ''
  className = ''
  checked = false
  files: unknown[] = []
  attrs = new Map<string, string>()
  listeners = new Map<string, ((event: unknown) => void)[]>()
  classList = { add() {}, remove() {}, toggle() {}, contains: () => false }

  addEventListener(type: string, listener: (event: unknown) => void) {
    const list = this.listeners.get(type) ?? []
    list.push(listener)
    this.listeners.set(type, list)
  }
  getAttribute(name: string) { return this.attrs.get(name) ?? null }
  setAttribute(name: string, value: string) { this.attrs.set(name, value) }
  hasAttribute(name: string) { return this.attrs.has(name) }
  fire(type: string, event: unknown) { for (const listener of this.listeners.get(type) ?? []) listener(event) }
  focus() {}
  select() {}
  close() {}
  showModal() {}
}

interface ClientExports {
  t: (key: string, params?: Record<string, string | number>) => string
  catLabel: (value?: string) => string
  setLang: (locale: string) => void
}

function bootClient(html: string, options: { storedLang?: string; token?: string } = {}) {
  const original = scriptOf(html)
  // 在 IIFE 收尾处注入测试出口，直接驱动真实的客户端代码
  const patched = original.replace(
    /\}\)\(\);\s*$/,
    '__pmClient.t = t; __pmClient.catLabel = catLabel; __pmClient.setLang = setLang;\n})();',
  )
  assert.notEqual(patched, original, '注入测试出口失败：脚本结尾结构可能变了')

  const elements = new Map<string, FakeElement>()
  const element = (id: string) => {
    let found = elements.get(id)
    if (!found) { found = new FakeElement(); elements.set(id, found) }
    return found
  }
  const selects = [new FakeElement(), new FakeElement()]
  const probe = new FakeElement()
  probe.setAttribute('data-i18n', 'web.unlock.title')
  const storage = () => {
    const map = new Map<string, string>()
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => map.set(key, value),
      removeItem: (key: string) => map.delete(key),
      map,
    }
  }
  const local = storage()
  const session = storage()
  if (options.storedLang) local.setItem('pm-lang', options.storedLang)
  if (options.token) session.setItem('pm-token', options.token)
  const fetchCalls: { path: string; body?: unknown }[] = []
  const document = {
    documentElement: { lang: '' },
    title: '',
    getElementById: element,
    createElement: () => new FakeElement(),
    querySelectorAll: (selector: string) =>
      selector === '.lang-select' ? selects
      : selector === '[data-i18n]' ? [probe]
      : [],
  }
  const exports: Partial<ClientExports> = {}

  const fn = new Function(
    'document', 'location', 'history', 'localStorage', 'sessionStorage', 'navigator', 'fetch',
    'setTimeout', 'setInterval', '__pmClient', patched,
  )
  fn(
    document,
    { search: '', pathname: '/' },
    { replaceState() {} },
    { getItem: local.getItem, setItem: local.setItem },
    { getItem: session.getItem, setItem: session.setItem, removeItem: session.removeItem },
    { clipboard: { writeText: async () => {} } },
    async (path: string, options?: { body?: string }) => {
      fetchCalls.push({ path, body: options?.body ? JSON.parse(options.body) : undefined })
      return {
        status: 200, ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ unlocked: false, total: 0, categories: [], uncategorized: 0 }),
        text: async () => '',
      }
    },
    () => 0, () => 0,
    exports,
  )

  return { exports: exports as ClientExports, document, local, fetchCalls, selects, probe }
}

describe('Web UI 客户端 i18n', () => {
  it('没有令牌时不请求接口', () => {
    const client = bootClient(zh)
    assert.deepEqual(client.fetchCalls, [])
    assert.equal(client.document.getElementById('unlock-error').textContent, '会话已失效：请使用启动时终端里打印的完整地址重新打开页面。')
  })

  it('首屏按服务端语言渲染，客户端 t()/分类标签可用', () => {
    const client = bootClient(zh, { token: 't' })
    assert.equal(client.probe.textContent, '解锁保险库', 'applyStatic 应把 data-i18n 文本换成中文')
    assert.equal(client.document.documentElement.lang, 'zh-CN')
    assert.equal(client.exports.t('web.unlock.title'), '解锁保险库')
    assert.equal(client.exports.t('cli.field.id'), 'cli.field.id', '浏览器端不该下发 CLI 词条')
    assert.equal(client.exports.catLabel('email'), '邮箱')
    assert.equal(client.exports.catLabel('自建分类'), '自建分类')
    assert.equal(client.exports.catLabel(''), '未分类')
  })

  it('切换语言会重绘并同步给服务端', () => {
    const client = bootClient(zh, { token: 't' })
    client.selects[0]!.value = 'en'
    client.selects[0]!.fire('change', { target: { value: 'en' } })

    assert.equal(client.probe.textContent, 'Unlock the vault', '切换后应重绘静态文案')
    assert.equal(client.document.documentElement.lang, 'en')
    assert.equal(client.exports.t('web.topbar.unlocked', { n: 1 }), 'Unlocked · 1 entry')
    assert.equal(client.exports.catLabel('email'), 'Email')
    assert.equal(client.local.getItem('pm-lang'), 'en')
    const sync = client.fetchCalls.find(call => call.path === '/api/lang')
    assert.deepEqual(sync?.body, { lang: 'en' })
  })

  it('浏览器里记住的语言优先于服务端默认值，并回同步给服务端', () => {
    const client = bootClient(en, { storedLang: 'zh', token: 't' })
    assert.equal(client.probe.textContent, '解锁保险库', '应立刻按记住的语言重绘')
    assert.equal(client.document.documentElement.lang, 'zh-CN')
    assert.equal(client.exports.catLabel('email'), '邮箱')
    const sync = client.fetchCalls.find(call => call.path === '/api/lang')
    assert.deepEqual(sync?.body, { lang: 'zh' })
  })
})
