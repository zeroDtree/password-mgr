/**
 * 自包含的单页 Web UI（无外部资源、无构建步骤）。
 * 注意：嵌入的脚本里避免使用模板字符串，以免与这里的模板字符串冲突。
 *
 * 国际化：服务端按当前语言渲染首屏，并把两种语言的目录（common 展示部分 + web）
 * 以 JSON 嵌入页面；页面上切换语言时无需刷新，直接重绘 DOM 并同步给服务端
 * （POST /api/lang），这样接口报错、刷新页面都会保持所选语言。
 * 静态文案用 data-i18n / data-i18n-html / data-i18n-placeholder / data-i18n-title 标记。
 */
import type { Catalog } from '../i18n/en.ts'
import { en } from '../i18n/en.ts'
import { zh } from '../i18n/zh.ts'
import { localeTag, translator, type Locale } from '../i18n/index.ts'

interface UIOptions {
  autoLockMinutes: number
  lang: Locale
}

/** 浏览器端只需要展示类词条，CLI 与服务端错误等不下发 */
function clientCatalog(catalog: Catalog) {
  return {
    common: {
      category: catalog.common.category,
      uncategorized: catalog.common.uncategorized,
      extra: catalog.common.extra,
    },
    web: catalog.web,
  }
}

/** 嵌入 <script> 的 JSON：把 < 转义掉，避免出现 </script> 序列 */
function embed(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

export function renderUI(options: UIOptions): string {
  const { lang, autoLockMinutes } = options
  const t = translator(lang)
  const i18n = embed({ en: clientCatalog(en), zh: clientCatalog(zh) })
  const unlockHint = autoLockMinutes
    ? t('web.unlock.hint', { n: autoLockMinutes })
    : t('web.unlock.hintNoAutoLock')

  return `<!doctype html>
<html lang="${localeTag(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${t('web.brand')}</title>
<style>
:root {
  color-scheme: light dark;
  --bg: #f3f4f8;
  --bg-grad: radial-gradient(1100px 560px at 18% -12%, #e4e9ff 0%, transparent 58%);
  --surface: #ffffff;
  --surface-2: #f3f4f8;
  --surface-3: #e9ebf2;
  --topbar: rgba(255,255,255,.82);
  --border: #e0e3ec;
  --border-strong: #c8cddb;
  --text: #14161c;
  --text-2: #4b5265;
  --muted: #7c8496;
  --accent: #4f6ef7;
  --accent-2: #6f88ff;
  --accent-text: #fff;
  --accent-soft: rgba(79,110,247,.10);
  --danger: #dd4a4f;
  --danger-soft: rgba(221,74,79,.10);
  --ok: #2f9e5f;
  --shadow-1: 0 1px 2px rgba(18,22,45,.05), 0 1px 3px rgba(18,22,45,.04);
  --shadow-2: 0 18px 44px rgba(18,22,45,.16);
  --radius: 14px;
  --radius-sm: 9px;
  --font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d0f14;
    --bg-grad: radial-gradient(1100px 620px at 15% -12%, rgba(79,110,247,.18) 0%, transparent 56%);
    --surface: #15181f;
    --surface-2: #1b1f28;
    --surface-3: #232833;
    --topbar: rgba(21,24,31,.82);
    --border: #262b35;
    --border-strong: #363d4b;
    --text: #e8eaf0;
    --text-2: #b4bac9;
    --muted: #7b8496;
    --accent: #6d8bff;
    --accent-2: #8ba2ff;
    --accent-soft: rgba(109,139,255,.14);
    --danger: #f0666b;
    --danger-soft: rgba(240,102,107,.14);
    --ok: #4ade80;
    --shadow-1: 0 1px 2px rgba(0,0,0,.35);
    --shadow-2: 0 18px 44px rgba(0,0,0,.55);
  }
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0; background: var(--bg); background-image: var(--bg-grad); background-attachment: fixed;
  color: var(--text); font: 14px/1.55 var(--font); -webkit-font-smoothing: antialiased;
  display: flex; flex-direction: column;
}
::selection { background: var(--accent-soft); }
* { scrollbar-width: thin; scrollbar-color: var(--border-strong) transparent; }
*::-webkit-scrollbar { width: 10px; height: 10px; }
*::-webkit-scrollbar-thumb {
  background: var(--border-strong); border-radius: 99px; border: 3px solid transparent; background-clip: content-box;
}
*::-webkit-scrollbar-thumb:hover { background: var(--muted); background-clip: content-box; }
*::-webkit-scrollbar-track { background: transparent; }

/* ---------------------------------------------------------------- 控件 */
button, input, select, textarea { font: inherit; color: inherit; }
button {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 34px; padding: 0 12px; white-space: nowrap;
  background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-sm);
  cursor: pointer; transition: background .12s ease, border-color .12s ease, color .12s ease, transform .04s ease;
}
button:hover { background: var(--surface-3); border-color: var(--border-strong); }
button:active { transform: translateY(1px); }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
button.primary { background: var(--accent); border-color: transparent; color: var(--accent-text); box-shadow: var(--shadow-1); }
button.primary:hover { background: var(--accent-2); }
button.ghost {
  height: 26px; padding: 0 8px; font-size: 12.5px;
  background: transparent; border-color: transparent; color: var(--text-2);
}
button.ghost:hover { background: var(--surface-3); border-color: transparent; color: var(--text); }
button.danger { color: var(--danger); }
button.danger:hover { background: var(--danger-soft); border-color: transparent; }
button.subtle { background: transparent; border-color: transparent; color: var(--text-2); }
button.subtle:hover { background: var(--surface-2); border-color: var(--border); color: var(--text); }
button.block { width: 100%; }
input, select, textarea {
  width: 100%; padding: 8px 10px; background: var(--surface-2);
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  transition: border-color .12s ease, box-shadow .12s ease, background .12s ease;
}
input:focus, select:focus, textarea:focus {
  outline: none; border-color: var(--accent); background: var(--surface); box-shadow: 0 0 0 3px var(--accent-soft);
}
input::placeholder, textarea::placeholder { color: var(--muted); }
textarea { resize: vertical; min-height: 62px; line-height: 1.5; }
.hidden { display: none !important; }
.muted { color: var(--muted); }
.lang-select {
  width: auto; height: 28px; padding: 0 8px; border-radius: 99px;
  background: var(--surface-2); border: 1px solid var(--border);
  color: var(--text-2); font-size: 12.5px; cursor: pointer;
}
.lang-select:focus { outline: 2px solid var(--accent); outline-offset: 1px; }

/* ---------------------------------------------------------------- 顶栏 */
.topbar {
  position: sticky; top: 0; z-index: 5;
  display: flex; align-items: center; gap: 10px;
  min-height: 58px; padding: 10px 18px;
  background: var(--topbar); border-bottom: 1px solid var(--border);
  backdrop-filter: saturate(180%) blur(14px);
}
.brand { display: flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 650; letter-spacing: .2px; }
.brand svg { width: 22px; height: 22px; color: var(--accent); }
.spacer { flex: 1; }
.pill {
  display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 12px;
  border-radius: 99px; background: var(--surface-2); border: 1px solid var(--border);
  color: var(--text-2); font-size: 12.5px;
}
.pill .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); transition: background .2s ease, box-shadow .2s ease; }
.pill.on .dot { background: var(--ok); box-shadow: 0 0 0 3px rgba(74,222,128,.18); }

/* ---------------------------------------------------------------- 布局 */
.layout {
  flex: 1; min-height: 0; width: 100%; max-width: 1520px; margin: 0 auto;
  display: grid; grid-template-columns: 268px minmax(280px, 360px) minmax(320px, 1fr);
  gap: 14px; padding: 14px 18px 18px;
}
.panel {
  display: flex; flex-direction: column; min-height: 0; overflow: hidden;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); box-shadow: var(--shadow-1);
}

/* ---------------------------------------------------------------- 侧栏 */
.sidebar { padding: 12px; gap: 12px; }
.search-wrap { position: relative; flex: none; }
.search-wrap svg {
  position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
  width: 15px; height: 15px; color: var(--muted); pointer-events: none;
}
.search {
  height: 36px; padding-left: 32px;
  /* 关掉 Safari 对 search 输入的原生 searchfield 外观，否则会与自定义聚焦样式叠成双层环 */
  -webkit-appearance: none; appearance: none;
}
.search::-webkit-search-cancel-button, .search::-webkit-search-decoration { -webkit-appearance: none; }
.side { flex: 1; min-height: 0; overflow: auto; margin: 0 -4px; padding: 0 4px; }
.side ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.side a {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 8px 10px; border-radius: var(--radius-sm);
  color: var(--text-2); text-decoration: none; cursor: pointer;
  transition: background .12s ease, color .12s ease;
}
.side a:hover { background: var(--surface-2); color: var(--text); }
.side a.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.side .count {
  min-width: 24px; padding: 1px 7px; border-radius: 99px; text-align: center;
  font-size: 11.5px; font-variant-numeric: tabular-nums;
  color: var(--muted); background: var(--surface-3);
}
.side a.active .count { background: transparent; color: inherit; }
.cat-header {
  flex: none; display: flex; align-items: center; justify-content: space-between;
  padding: 0 4px 6px; font-size: 12px; color: var(--muted);
}
.cat-header button { height: 22px; padding: 0 6px; font-size: 12px; }
.cat-actions { flex: none; display: flex; gap: 6px; padding: 6px 0 2px; border-top: 1px solid var(--border); }
.cat-actions button { flex: 1; }
.sidebar-actions { flex: none; display: flex; flex-direction: column; gap: 8px; padding-top: 12px; border-top: 1px solid var(--border); }
.sidebar-actions .row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }

/* ---------------------------------------------------------------- 列表 */
.list { flex: 1; min-height: 0; overflow: auto; padding: 8px; display: flex; flex-direction: column; gap: 2px; }
.item {
  padding: 10px 12px; border-radius: var(--radius-sm); cursor: pointer;
  border: 1px solid transparent; transition: background .12s ease, box-shadow .12s ease, border-color .12s ease;
}
.item:hover { background: var(--surface-2); }
.item.active { background: var(--surface-2); border-color: var(--border); box-shadow: inset 3px 0 0 var(--accent); }
.item.dragging { opacity: .4; }
.side a.drop-target {
  background: var(--accent-soft); color: var(--accent); font-weight: 600;
  box-shadow: inset 0 0 0 1.5px var(--accent);
}
.side a.drop-target .count { background: transparent; color: inherit; }
.item .title { display: flex; align-items: center; gap: 8px; min-width: 0; font-weight: 600; }
.item .title .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item .meta {
  margin-top: 3px; font-size: 12.5px; color: var(--muted);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.badge {
  flex: none; padding: 1px 8px; border-radius: 99px; font-size: 11px; font-weight: 500;
  color: var(--text-2); background: var(--surface-3); border: 1px solid var(--border);
}

/* ---------------------------------------------------------------- 详情 */
.detail { flex: 1; min-height: 0; overflow: auto; padding: 20px 22px; }
.detail h2 { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 0 0 18px; font-size: 20px; letter-spacing: .2px; }
.detail dl { display: grid; grid-template-columns: 80px minmax(0, 1fr); gap: 12px 14px; margin: 0; align-items: start; }
.detail dt { color: var(--muted); font-size: 13px; padding-top: 6px; }
.detail dd { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 0; min-width: 0; }
.detail dd > .secret { min-width: 0; overflow-wrap: anywhere; }
.secret {
  padding: 4px 9px; border-radius: 7px; font-family: var(--mono); font-size: 13px;
  background: var(--surface-2); border: 1px solid var(--border);
}
.row-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--border); }

/* ---------------------------------------------------------------- 空状态 / 解锁 */
.empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  height: 100%; min-height: 220px; padding: 30px; text-align: center; color: var(--muted); font-size: 13.5px;
}
.empty svg { width: 32px; height: 32px; opacity: .45; }
.overlay {
  position: fixed; inset: 0; z-index: 20; display: flex; align-items: center; justify-content: center;
  padding: 20px; background: var(--bg); background-image: var(--bg-grad);
}
.unlock-lang { position: absolute; top: 18px; right: 20px; }
.card {
  width: min(400px, 100%); padding: 30px; border-radius: 18px;
  background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow-2);
}
.card .lock-icon {
  display: grid; place-items: center; width: 46px; height: 46px; margin-bottom: 18px;
  border-radius: 13px; background: var(--accent-soft); color: var(--accent);
}
.card .lock-icon svg { width: 24px; height: 24px; }
.card h2 { margin: 0 0 6px; font-size: 19px; letter-spacing: .2px; }
.card > p { margin: 0 0 20px; color: var(--muted); font-size: 13px; }
.card .hint { margin: 16px 0 0; color: var(--muted); font-size: 12px; line-height: 1.6; }
.field { margin-bottom: 12px; }
.field > label { display: block; margin-bottom: 6px; color: var(--muted); font-size: 12.5px; }
.inline { display: flex; gap: 8px; align-items: center; }
.error { min-height: 18px; margin-top: 8px; color: var(--danger); font-size: 13px; }

/* ---------------------------------------------------------------- 弹窗 / 提示 */
dialog {
  width: min(540px, 92vw); padding: 22px; border: 1px solid var(--border); border-radius: 16px;
  background: var(--surface); color: var(--text); box-shadow: var(--shadow-2);
}
dialog::backdrop { background: rgba(6,8,14,.55); backdrop-filter: blur(3px); }
dialog h3 { margin: 0 0 16px; font-size: 17px; }
dialog p { margin: 0 0 16px; color: var(--muted); font-size: 13.5px; }
dialog .warn {
  padding: 10px 12px; border-radius: var(--radius-sm); color: var(--danger);
  background: var(--danger-soft); border: 1px solid transparent;
}
dialog .warn strong { font-weight: 650; }
dialog .footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
#toast {
  position: fixed; bottom: 26px; left: 50%; z-index: 30; max-width: 82vw;
  padding: 10px 16px; border-radius: 11px; font-size: 13.5px;
  background: var(--surface); border: 1px solid var(--border-strong); box-shadow: var(--shadow-2);
  opacity: 0; pointer-events: none; transform: translate(-50%, 10px);
  transition: opacity .18s ease, transform .18s ease;
}
#toast.show { opacity: 1; transform: translate(-50%, 0); }
#toast.err { border-color: var(--danger); color: var(--danger); }

/* ---------------------------------------------------------------- 窄屏
   单列堆叠，面板按内容展开，由页面整体滚动（必须放在最后以覆盖上面的规则） */
@media (max-width: 1080px) {
  /* 解开高度约束，让内容自然撑开、由视口滚动 */
  .layout { grid-template-columns: 1fr; flex: none; height: auto; min-height: auto; overflow: visible; }
  .panel { max-height: none; overflow: visible; }
  .side, .list, .detail { overflow: visible; }
  .empty { min-height: 150px; }
}
</style>
</head>
<body>

<div id="unlock" class="overlay">
  <div class="unlock-lang">
    <select class="lang-select" aria-label="${t('web.topbar.language')}">
      <option value="en">English</option>
      <option value="zh">中文</option>
    </select>
  </div>
  <div class="card">
    <div class="lock-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="10.5" width="17" height="10.5" rx="3"/><path d="M7.5 10.5V7a4.5 4.5 0 0 1 9 0v3.5"/><circle cx="12" cy="15.7" r="1.5" fill="currentColor" stroke="none"/></svg>
    </div>
    <h2 data-i18n="web.unlock.title">${t('web.unlock.title')}</h2>
    <p data-i18n="web.unlock.intro">${t('web.unlock.intro')}</p>
    <div class="field">
      <label for="master" data-i18n="web.unlock.masterPassword">${t('web.unlock.masterPassword')}</label>
      <input id="master" type="password" autocomplete="current-password" autofocus>
    </div>
    <button id="unlock-btn" class="primary block" data-i18n="web.unlock.button">${t('web.unlock.button')}</button>
    <div id="unlock-error" class="error"></div>
    <p class="hint" id="unlock-hint">${unlockHint}</p>
  </div>
</div>

<header class="topbar">
  <div class="brand">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="10.5" width="17" height="10.5" rx="3"/><path d="M7.5 10.5V7a4.5 4.5 0 0 1 9 0v3.5"/><circle cx="12" cy="15.7" r="1.5" fill="currentColor" stroke="none"/></svg>
    <span data-i18n="web.brand">${t('web.brand')}</span>
  </div>
  <div class="spacer"></div>
  <span class="pill" id="status-pill"><i class="dot"></i><span id="status-text">${t('web.topbar.locked')}</span></span>
  <select class="lang-select" aria-label="${t('web.topbar.language')}">
    <option value="en">English</option>
    <option value="zh">中文</option>
  </select>
  <button id="chpwd-btn" class="subtle" data-i18n="web.topbar.changePassword">${t('web.topbar.changePassword')}</button>
  <button id="lock-btn" data-i18n="web.topbar.lock">${t('web.topbar.lock')}</button>
</header>

<main id="app" class="layout hidden">
  <aside class="panel sidebar">
    <div class="search-wrap">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>
      <input id="search" class="search" type="search" placeholder="${t('web.sidebar.search')}" data-i18n-placeholder="web.sidebar.search">
    </div>
    <div class="cat-header">
      <span data-i18n="web.sidebar.categories">${t('web.sidebar.categories')}</span>
      <button id="cat-add" class="ghost" title="${t('web.sidebar.newCategory')}" data-i18n="web.sidebar.newCategory" data-i18n-title="web.sidebar.newCategory">${t('web.sidebar.newCategory')}</button>
    </div>
    <nav class="side"><ul id="categories"></ul></nav>
    <div class="cat-actions hidden" id="cat-actions">
      <button id="cat-rename" class="ghost" data-i18n="web.sidebar.rename">${t('web.sidebar.rename')}</button>
      <button id="cat-delete" class="ghost danger" data-i18n="web.sidebar.delete">${t('web.sidebar.delete')}</button>
    </div>
    <div class="sidebar-actions">
      <button id="add-btn" class="primary block" data-i18n="web.sidebar.addEntry">${t('web.sidebar.addEntry')}</button>
      <div class="row">
        <button id="import-btn" data-i18n="web.sidebar.import">${t('web.sidebar.import')}</button>
        <button id="export-btn" data-i18n="web.sidebar.export">${t('web.sidebar.export')}</button>
      </div>
    </div>
  </aside>

  <section class="panel list-panel"><div id="list" class="list"></div></section>

  <section class="panel detail-panel">
    <div id="detail" class="detail">
      <div class="empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="10.5" width="17" height="10.5" rx="3"/><path d="M7.5 10.5V7a4.5 4.5 0 0 1 9 0v3.5"/></svg>
        <span data-i18n="web.detail.placeholder">${t('web.detail.placeholder')}</span>
      </div>
    </div>
  </section>
</main>

<dialog id="entry-dialog">
  <h3 id="entry-dialog-title">${t('web.entry.new')}</h3>
  <input type="hidden" id="f-id">
  <div class="field">
    <label data-i18n="web.entry.category">${t('web.entry.category')}</label>
    <input id="f-category" list="category-options" placeholder="${t('web.entry.categoryPlaceholder')}" data-i18n-placeholder="web.entry.categoryPlaceholder">
    <datalist id="category-options"></datalist>
  </div>
  <div class="field"><label data-i18n="web.entry.title">${t('web.entry.title')}</label><input id="f-title" placeholder="${t('web.entry.titlePlaceholder')}" data-i18n-placeholder="web.entry.titlePlaceholder"></div>
  <div class="field"><label data-i18n="web.entry.username">${t('web.entry.username')}</label><input id="f-username"></div>
  <div class="field">
    <label data-i18n="web.entry.password">${t('web.entry.password')}</label>
    <div class="inline">
      <input id="f-password" type="password" autocomplete="new-password">
      <button type="button" id="f-toggle" title="${t('web.entry.togglePassword')}" data-i18n-title="web.entry.togglePassword">👁</button>
      <button type="button" id="f-generate" title="${t('web.entry.generateTitle')}" data-i18n-title="web.entry.generateTitle" data-i18n="web.entry.generate">${t('web.entry.generate')}</button>
    </div>
  </div>
  <div class="field"><label data-i18n="web.entry.url">${t('web.entry.url')}</label><input id="f-url" placeholder="https://"></div>
  <div class="field"><label data-i18n="web.entry.notes">${t('web.entry.notes')}</label><textarea id="f-notes" rows="2"></textarea></div>
  <div class="field"><label data-i18n="web.entry.tags">${t('web.entry.tags')}</label><input id="f-tags"></div>
  <div class="field">
    <label data-i18n="web.entry.extra">${t('web.entry.extra')}</label>
    <textarea id="f-extra" rows="3" placeholder="${t('web.entry.extraPlaceholder')}" data-i18n-placeholder="web.entry.extraPlaceholder"></textarea>
  </div>
  <div class="error" id="entry-error"></div>
  <div class="footer">
    <button id="entry-cancel" data-i18n="web.entry.cancel">${t('web.entry.cancel')}</button>
    <button id="entry-save" class="primary" data-i18n="web.entry.save">${t('web.entry.save')}</button>
  </div>
</dialog>

<dialog id="export-dialog">
  <h3 data-i18n="web.exportDialog.title">${t('web.exportDialog.title')}</h3>
  <p class="warn" data-i18n-html="web.exportDialog.warn">${t('web.exportDialog.warn')}</p>
  <div class="field">
    <label data-i18n="web.exportDialog.plaintext">${t('web.exportDialog.plaintext')}</label>
    <div class="inline">
      <button id="export-json">JSON</button>
      <button id="export-csv">CSV</button>
    </div>
  </div>
  <div class="field">
    <label data-i18n="web.exportDialog.encrypted">${t('web.exportDialog.encrypted')}</label>
    <button id="export-vault" class="block" data-i18n="web.exportDialog.download">${t('web.exportDialog.download')}</button>
    <p class="muted" style="margin:8px 0 0;font-size:12.5px;line-height:1.6" data-i18n="web.exportDialog.note">${t('web.exportDialog.note')}</p>
  </div>
  <div class="footer">
    <button id="export-cancel" data-i18n="web.entry.cancel">${t('web.entry.cancel')}</button>
  </div>
</dialog>

<dialog id="confirm-dialog">
  <h3 data-i18n="web.confirm.title">${t('web.confirm.title')}</h3>
  <p id="confirm-text"></p>
  <div class="field hidden" id="confirm-field">
    <label id="confirm-label" for="confirm-input"></label>
    <input id="confirm-input">
  </div>
  <div class="footer">
    <button id="confirm-cancel" data-i18n="web.entry.cancel">${t('web.entry.cancel')}</button>
    <button id="confirm-ok" class="danger">${t('web.confirm.ok')}</button>
  </div>
</dialog>

<dialog id="import-dialog">
  <h3 data-i18n="web.importDialog.title">${t('web.importDialog.title')}</h3>
  <div class="field">
    <label data-i18n="web.importDialog.file">${t('web.importDialog.file')}</label>
    <input id="i-file" type="file" accept=".json,.csv,.pmv,application/json,text/csv">
  </div>
  <div class="field">
    <label data-i18n="web.importDialog.paste">${t('web.importDialog.paste')}</label>
    <textarea id="i-text" rows="5" placeholder="${t('web.importDialog.placeholder')}" data-i18n-placeholder="web.importDialog.placeholder"></textarea>
  </div>
  <div class="field">
    <label data-i18n="web.importDialog.password">${t('web.importDialog.password')}</label>
    <input id="i-password" type="password" autocomplete="off" placeholder="${t('web.importDialog.passwordPlaceholder')}" data-i18n-placeholder="web.importDialog.passwordPlaceholder">
  </div>
  <div class="field inline">
    <input id="i-keep" type="checkbox" style="width:auto">
    <label for="i-keep" style="margin:0" data-i18n="web.importDialog.keepDuplicates">${t('web.importDialog.keepDuplicates')}</label>
  </div>
  <div class="error" id="import-error"></div>
  <div class="footer">
    <button id="import-cancel" data-i18n="web.entry.cancel">${t('web.entry.cancel')}</button>
    <button id="import-confirm" class="primary" data-i18n="web.importDialog.submit">${t('web.importDialog.submit')}</button>
  </div>
</dialog>

<dialog id="chpwd-dialog">
  <h3 data-i18n="web.chpwd.title">${t('web.chpwd.title')}</h3>
  <div class="field"><label data-i18n="web.chpwd.old">${t('web.chpwd.old')}</label><input id="p-old" type="password" autocomplete="current-password"></div>
  <div class="field"><label data-i18n="web.chpwd.next">${t('web.chpwd.next')}</label><input id="p-new" type="password" autocomplete="new-password"></div>
  <div class="field"><label data-i18n="web.chpwd.repeat">${t('web.chpwd.repeat')}</label><input id="p-repeat" type="password" autocomplete="new-password"></div>
  <div class="error" id="chpwd-error"></div>
  <div class="footer">
    <button id="chpwd-cancel" data-i18n="web.entry.cancel">${t('web.entry.cancel')}</button>
    <button id="chpwd-save" class="primary" data-i18n="web.chpwd.submit">${t('web.chpwd.submit')}</button>
  </div>
</dialog>

<div id="toast"></div>

<script>
(function () {
  'use strict';
  var I18N = ${i18n};
  var LANG = ${JSON.stringify(lang)};
  var AUTO_LOCK = ${autoLockMinutes};
  var EXTRA_ORDER = ['category', 'url', 'notes', 'tags'];
  var state = { token: '', unlocked: false, entries: [], detail: null, category: '', query: '', editingKeys: [], categories: [], total: 0, uncategorized: 0 };
  var pluralRules = null;

  // ---------------------------------------------------------------- i18n
  function lookup(root, key) {
    var parts = key.split('.');
    for (var i = 0; i < parts.length; i++) {
      if (root == null) return null;
      root = root[parts[i]];
    }
    return root == null ? null : root;
  }
  function interpolate(text, params) {
    if (!params) return text;
    return text.replace(/\\{(\\w+)\\}/g, function (match, name) {
      return name in params ? String(params[name]) : match;
    });
  }
  function t(key, params) {
    var node = lookup(I18N[LANG], key) || lookup(I18N.en, key);
    if (node == null) return key;
    if (typeof node === 'object') {
      if (!pluralRules) pluralRules = new Intl.PluralRules(LANG);
      node = node[pluralRules.select(Number(params && params.n) || 0)] || node.other;
    }
    return interpolate(String(node), params);
  }
  function catLabel(value) {
    if (!value) return t('common.uncategorized');
    var key = 'common.category.' + value;
    var label = t(key);
    return label === key ? value : label;
  }
  function extraLabel(key) {
    var labelKey = 'common.extra.' + key;
    var label = t(labelKey);
    return label === labelKey ? key : label;
  }

  function $(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function entryCategory(entry) {
    return entry && entry.extra ? entry.extra.category : undefined;
  }
  // 约定键优先，其余键按字母序
  function orderedExtraKeys(extra) {
    var preferred = EXTRA_ORDER.filter(function (k) { return k in extra; });
    var rest = Object.keys(extra).filter(function (k) { return EXTRA_ORDER.indexOf(k) < 0; }).sort();
    return preferred.concat(rest);
  }
  function toast(message, isError) {
    var el = $('toast');
    el.textContent = message;
    el.className = 'show' + (isError ? ' err' : '');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { el.className = ''; }, 2600);
  }
  function fail(error) {
    if (error && error.message !== 'unauthorized') toast(error.message || t('web.toast.failed'), true);
  }

  function applyStatic() {
    document.documentElement.lang = LANG === 'zh' ? 'zh-CN' : 'en';
    document.title = t('web.brand');
    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = t(nodes[i].getAttribute('data-i18n'));
    nodes = document.querySelectorAll('[data-i18n-html]');
    for (i = 0; i < nodes.length; i++) nodes[i].innerHTML = t(nodes[i].getAttribute('data-i18n-html'));
    nodes = document.querySelectorAll('[data-i18n-placeholder]');
    for (i = 0; i < nodes.length; i++) nodes[i].placeholder = t(nodes[i].getAttribute('data-i18n-placeholder'));
    nodes = document.querySelectorAll('[data-i18n-title]');
    for (i = 0; i < nodes.length; i++) nodes[i].title = t(nodes[i].getAttribute('data-i18n-title'));
    nodes = document.querySelectorAll('.lang-select');
    for (i = 0; i < nodes.length; i++) nodes[i].value = LANG;
    $('unlock-hint').textContent = AUTO_LOCK ? t('web.unlock.hint', { n: AUTO_LOCK }) : t('web.unlock.hintNoAutoLock');
    renderStatus({ unlocked: state.unlocked, total: state.total });
    renderCategories();
    renderList();
    renderDetail();
  }

  function setLang(next) {
    if (!I18N[next] || next === LANG) return;
    LANG = next;
    pluralRules = null;
    try { localStorage.setItem('pm-lang', LANG); } catch (error) { /* 隐私模式等场景忽略 */ }
    // 同步给服务端：之后接口报错、刷新页面都会保持同一语言
    if (state.token) api('/api/lang', { method: 'POST', body: { lang: LANG } }).catch(function () {});
    applyStatic();
  }

  // ---------------------------------------------------------------- token
  var params = new URLSearchParams(location.search);
  var urlLang = params.get('lang');
  if (urlLang && I18N[urlLang]) {
    LANG = urlLang;
  } else {
    try {
      var storedLang = localStorage.getItem('pm-lang');
      if (storedLang && I18N[storedLang]) LANG = storedLang;
    } catch (error) { /* 隐私模式等场景忽略 */ }
  }
  var fromUrl = params.get('token');
  if (fromUrl) {
    sessionStorage.setItem('pm-token', fromUrl);
    history.replaceState(null, '', location.pathname);
  }
  state.token = sessionStorage.getItem('pm-token') || '';
  var pollTimer = 0;

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = 0;
  }

  function forgetToken() {
    state.token = '';
    try { sessionStorage.removeItem('pm-token'); } catch (error) { /* 隐私模式等场景忽略 */ }
    stopPolling();
  }

  async function api(path, options) {
    options = options || {};
    var headers = { 'x-vault-token': state.token };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    var res = await fetch(path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (res.status === 401) {
      forgetToken();
      showUnlock(t('web.unlock.sessionExpired'));
      throw new Error('unauthorized');
    }
    var type = res.headers.get('content-type') || '';
    var data = type.indexOf('json') >= 0 ? await res.json() : await res.text();
    if (!res.ok) throw new Error((data && data.message) || ('HTTP ' + res.status));
    return data;
  }

  // ---------------------------------------------------------------- view
  function showUnlock(message) {
    state.unlocked = false;
    $('unlock').classList.remove('hidden');
    $('app').classList.add('hidden');
    $('status-text').textContent = t('web.topbar.locked');
    $('status-pill').classList.remove('on');
    $('unlock-error').textContent = message || '';
    setTimeout(function () { $('master').focus(); }, 30);
  }

  async function showApp() {
    state.unlocked = true;
    $('unlock').classList.add('hidden');
    $('app').classList.remove('hidden');
    $('master').value = '';
    renderCategories();
    await loadEntries();
  }

  function categoryRow(value, label, count, active) {
    return '<li><a data-category="' + esc(value) + '" class="' + (active ? 'active' : '') + '">'
      + '<span>' + esc(label) + '</span><span class="count">' + count + '</span></a></li>';
  }

  function renderCategories() {
    var html = categoryRow('', t('web.sidebar.all'), state.total || 0, state.category === '');
    var list = state.categories || [];
    for (var i = 0; i < list.length; i++) {
      html += categoryRow(list[i].value, catLabel(list[i].value), list[i].count || 0, state.category === list[i].value);
    }
    html += categoryRow('__none__', t('common.uncategorized'), state.uncategorized || 0, state.category === '__none__');
    $('categories').innerHTML = html;

    // 选中任意具体分类（含内置）时都显示重命名/删除
    var hasCurrent = !!state.category && state.category !== '__none__';
    $('cat-actions').classList.toggle('hidden', !hasCurrent);
  }

  /** 分类建议：内置 + 自定义，用于输入框的 datalist */
  function renderCategoryOptions() {
    $('category-options').innerHTML = (state.categories || []).map(function (item) {
      return '<option value="' + esc(item.value) + '">' + esc(catLabel(item.value)) + '</option>';
    }).join('');
  }

  var ICON_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="10.5" width="17" height="10.5" rx="3"/><path d="M7.5 10.5V7a4.5 4.5 0 0 1 9 0v3.5"/></svg>';
  var ICON_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>';

  function renderList() {
    if (!state.entries.length) {
      $('list').innerHTML = '<div class="empty">' + ICON_SEARCH + '<span>' + esc(t('web.sidebar.empty')) + '</span></div>';
      return;
    }
    var html = '';
    for (var i = 0; i < state.entries.length; i++) {
      var entry = state.entries[i];
      var active = state.detail && state.detail.id === entry.id ? ' active' : '';
      var meta = [entry.username, entry.extra && entry.extra.url].filter(Boolean).join(' · ');
      html += '<div class="item' + active + '" data-id="' + esc(entry.id) + '" draggable="true"'
        + ' title="' + esc(entry.title + t('web.detail.dragHint')) + '">'
        + '<div class="title" title="' + esc(entry.title) + '">'
        + '<span class="name">' + esc(entry.title) + '</span>'
        + '<span class="badge">' + esc(catLabel(entryCategory(entry))) + '</span></div>'
        + (meta ? '<div class="meta" title="' + esc(meta) + '">' + esc(meta) + '</div>' : '')
        + '</div>';
    }
    $('list').innerHTML = html;
  }

  function secretRow(label, value, isSecret) {
    if (!value) return '';
    var html = '<dt>' + esc(label) + '</dt><dd>';
    if (isSecret) {
      html += '<span class="secret" data-secret="hidden">••••••••</span> ';
      html += '<button class="ghost" data-reveal>' + esc(t('web.detail.show')) + '</button>';
    } else {
      html += '<span class="secret">' + esc(value) + '</span> ';
    }
    html += '<button class="ghost" data-copy="' + esc(value) + '">' + esc(t('web.detail.copy')) + '</button>';
    html += '</dd>';
    return html;
  }

  function renderDetail() {
    var entry = state.detail;
    if (!entry) {
      $('detail').innerHTML = '<div class="empty">' + ICON_LOCK + '<span>' + esc(t('web.detail.placeholder')) + '</span></div>';
      return;
    }
    var extra = entry.extra || {};
    var html = '<h2>' + esc(entry.title) + ' <span class="badge">' + esc(catLabel(entryCategory(entry))) + '</span></h2>';
    html += '<dl>';
    html += secretRow(t('web.detail.username'), entry.username, false);
    html += secretRow(t('web.detail.password'), entry.password, true);
    var keys = orderedExtraKeys(extra);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (key === 'category') continue;
      var value = extra[key];
      if (key === 'tags') value = value.split('|').join(', ');
      if (value) html += secretRow(extraLabel(key), value, false);
    }
    html += '<dt>' + esc(t('web.detail.updated')) + '</dt><dd class="muted">' + esc(new Date(entry.updatedAt).toLocaleString(LANG === 'zh' ? 'zh-CN' : 'en')) + '</dd>';
    html += '</dl>';
    html += '<div class="row-actions">'
      + '<button id="d-edit">' + esc(t('web.detail.edit')) + '</button>'
      + '<button id="d-delete" class="danger">' + esc(t('web.detail.delete')) + '</button>'
      + '</div>';
    $('detail').innerHTML = html;
  }

  // ---------------------------------------------------------------- data
  function renderStatus(status) {
    if (status.unlocked) {
      $('status-text').textContent = t('web.topbar.unlocked', { n: status.total || 0 });
      $('status-pill').classList.add('on');
    } else {
      $('status-text').textContent = t('web.topbar.locked');
      $('status-pill').classList.remove('on');
    }
  }

  async function refreshStatus() {
    try {
      var status = await api('/api/status');
      state.total = status.total || 0;
      state.uncategorized = status.uncategorized || 0;
      state.categories = status.categories || [];
      if (status.unlocked) {
        if (!state.unlocked) await showApp();
        else await loadEntries();
      } else if (state.unlocked) {
        state.detail = null;
        showUnlock(t('web.unlock.lockedNotice'));
      }
      renderStatus(status);
    } catch (error) { fail(error); }
  }

  async function loadEntries() {
    var path = state.category === '__none__'
      ? '/api/entries?uncategorized=true&query=' + encodeURIComponent(state.query)
      : '/api/entries?category=' + encodeURIComponent(state.category) + '&query=' + encodeURIComponent(state.query);
    var data = await api(path);
    state.entries = data.entries;
    renderCategories();
    renderList();
  }

  async function selectEntry(id) {
    var data = await api('/api/entries/' + encodeURIComponent(id));
    state.detail = data.entry;
    renderList();
    renderDetail();
  }

  // ---------------------------------------------------------------- entry form
  function openEntryDialog(entry) {
    renderCategoryOptions();
    $('entry-dialog-title').textContent = entry ? t('web.entry.edit') : t('web.entry.new');
    $('f-id').value = entry ? entry.id : '';
    var extra = (entry && entry.extra) || {};
    var current = entryCategory(entry);
    $('f-category').value = entry ? (current || '') : (state.category && state.category !== '__none__' ? state.category : 'other');
    $('f-title').value = entry ? entry.title : '';
    $('f-username').value = entry ? (entry.username || '') : '';
    $('f-password').value = entry ? (entry.password || '') : '';
    $('f-password').type = 'password';
    $('f-url').value = extra.url || '';
    $('f-notes').value = extra.notes || '';
    $('f-tags').value = extra.tags ? extra.tags.split('|').join(', ') : '';
    // 非常规键显示在“额外字段”文本域里
    var lines = [];
    var keys = orderedExtraKeys(extra);
    for (var i = 0; i < keys.length; i++) {
      if (EXTRA_ORDER.indexOf(keys[i]) >= 0) continue;
      lines.push(keys[i] + '=' + extra[keys[i]]);
    }
    $('f-extra').value = lines.join('\\n');
    // 记住原有键，保存时才能把被删掉的键一并清除
    state.editingKeys = entry ? Object.keys(extra) : [];
    $('entry-error').textContent = '';
    $('entry-dialog').showModal();
    setTimeout(function () { $('f-title').focus(); }, 30);
  }

  async function saveEntry() {
    var id = $('f-id').value;
    var extra = {};
    var category = $('f-category').value.trim();
    if (category) extra.category = category;
    var url = $('f-url').value.trim();
    var notes = $('f-notes').value;
    var tags = $('f-tags').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (url) extra.url = url;
    if (notes) extra.notes = notes;
    if (tags.length) extra.tags = tags.join('|');

    var lines = $('f-extra').value.split('\\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var at = line.indexOf('=');
      if (at <= 0) { $('entry-error').textContent = t('web.entry.extraFormat', { line: line }); return; }
      extra[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
    // 编辑时把已经被删掉的原有键置空，服务端据此删除
    var original = state.editingKeys || [];
    for (var j = 0; j < original.length; j++) {
      if (!(original[j] in extra)) extra[original[j]] = '';
    }

    var payload = {
      title: $('f-title').value.trim(),
      username: $('f-username').value,
      password: $('f-password').value,
      extra: extra,
    };
    if (!payload.title) { $('entry-error').textContent = t('web.entry.titleRequired'); return; }
    try {
      var data = id
        ? await api('/api/entries/' + encodeURIComponent(id), { method: 'PATCH', body: payload })
        : await api('/api/entries', { method: 'POST', body: payload });
      $('entry-dialog').close();
      toast(id ? t('web.entry.updated') : t('web.entry.added'));
      await refreshStatus();
      await selectEntry(data.entry.id);
    } catch (error) {
      $('entry-error').textContent = error.message;
    }
  }

  // ---------------------------------------------------------------- events
  $('unlock-btn').addEventListener('click', async function () {
    var password = $('master').value;
    if (!password) return;
    $('unlock-error').textContent = '';
    try {
      await api('/api/unlock', { method: 'POST', body: { password: password } });
      await showApp();
      await refreshStatus();
    } catch (error) {
      $('unlock-error').textContent = error.message;
      $('master').select();
    }
  });
  $('master').addEventListener('keydown', function (event) {
    if (event.key === 'Enter') $('unlock-btn').click();
  });

  var langSelects = document.querySelectorAll('.lang-select');
  for (var li = 0; li < langSelects.length; li++) {
    langSelects[li].addEventListener('change', function (event) { setLang(event.target.value); });
  }

  $('lock-btn').addEventListener('click', async function () {
    try {
      await api('/api/lock', { method: 'POST' });
      state.detail = null;
      renderDetail();
      showUnlock(t('web.unlock.lockedNotice'));
    } catch (error) { fail(error); }
  });

  $('search').addEventListener('input', function () {
    state.query = $('search').value.trim();
    clearTimeout($('search')._timer);
    $('search')._timer = setTimeout(function () { loadEntries().catch(fail); }, 200);
  });

  $('categories').addEventListener('click', function (event) {
    var link = event.target.closest('a[data-category]');
    if (!link) return;
    state.category = link.getAttribute('data-category');
    loadEntries().catch(fail);
  });

  $('list').addEventListener('click', function (event) {
    var item = event.target.closest('.item');
    if (item) selectEntry(item.getAttribute('data-id')).catch(fail);
  });

  $('detail').addEventListener('click', async function (event) {
    var entry = state.detail;
    if (!entry) return;
    if (event.target.id === 'd-edit') return openEntryDialog(entry);
    if (event.target.id === 'd-delete') {
      askConfirm(t('web.confirm.deleteEntry', { title: entry.title }), t('web.detail.delete'), async function () {
        try {
          await api('/api/entries/' + encodeURIComponent(entry.id), { method: 'DELETE' });
          state.detail = null;
          renderDetail();
          toast(t('web.toast.deleted'));
          await refreshStatus();
        } catch (error) { fail(error); }
      });
      return;
    }
    if (event.target.hasAttribute('data-copy')) {
      try {
        await navigator.clipboard.writeText(event.target.getAttribute('data-copy'));
        toast(t('web.toast.copied'));
      } catch (error) { fail(error); }
      return;
    }
    if (event.target.hasAttribute('data-reveal')) {
      var span = event.target.previousElementSibling;
      var hidden = span.getAttribute('data-secret') === 'hidden';
      span.textContent = hidden ? entry.password : '••••••••';
      span.setAttribute('data-secret', hidden ? 'shown' : 'hidden');
      event.target.textContent = hidden ? t('web.detail.hide') : t('web.detail.show');
    }
  });

  $('add-btn').addEventListener('click', function () { openEntryDialog(null); });
  $('entry-cancel').addEventListener('click', function () { $('entry-dialog').close(); });
  $('entry-save').addEventListener('click', function () { saveEntry(); });
  $('f-toggle').addEventListener('click', function () {
    $('f-password').type = $('f-password').type === 'password' ? 'text' : 'password';
  });
  $('f-generate').addEventListener('click', async function () {
    try {
      var data = await api('/api/generate', { method: 'POST', body: { length: 20 } });
      $('f-password').value = data.password;
      $('f-password').type = 'text';
    } catch (error) { fail(error); }
  });

  // ---------------------------------------------------------------- import / export
  async function doExport(format) {
    try {
      var res = await fetch('/api/export?format=' + format, { headers: { 'x-vault-token': state.token } });
      if (!res.ok) throw new Error(t('web.exportDialog.failed', { status: res.status }));
      var blob = await res.blob();
      var link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'passwords-' + new Date().toISOString().slice(0, 10) + '.' + (format === 'vault' ? 'pmv' : format);
      link.click();
      URL.revokeObjectURL(link.href);
      $('export-dialog').close();
      toast(format === 'vault' ? t('web.exportDialog.exportedVault') : t('web.exportDialog.exportedPlain'));
    } catch (error) { fail(error); }
  }

  $('export-btn').addEventListener('click', function () { $('export-dialog').showModal(); });
  $('export-cancel').addEventListener('click', function () { $('export-dialog').close(); });
  $('export-json').addEventListener('click', function () { doExport('json'); });
  $('export-csv').addEventListener('click', function () { doExport('csv'); });
  $('export-vault').addEventListener('click', function () { doExport('vault'); });

  // 应用内确认框（原生 confirm 的按钮语言不受控，且表达不了多选）
  var pendingConfirm = null;
  // opts.input = { label, value } 时弹窗里会多一个输入框，值作为回调参数
  function askConfirm(text, okLabel, onOk, opts) {
    $('confirm-text').textContent = text;
    $('confirm-ok').textContent = okLabel;
    var field = $('confirm-field');
    if (opts && opts.input) {
      $('confirm-label').textContent = opts.input.label;
      $('confirm-input').value = opts.input.value || '';
      field.classList.remove('hidden');
    } else {
      field.classList.add('hidden');
    }
    pendingConfirm = onOk;
    $('confirm-dialog').showModal();
    if (opts && opts.input) setTimeout(function () { $('confirm-input').focus(); }, 30);
  }
  $('confirm-cancel').addEventListener('click', function () {
    pendingConfirm = null;
    $('confirm-dialog').close();
  });
  $('confirm-ok').addEventListener('click', function () {
    var action = pendingConfirm;
    var value = $('confirm-input').value;
    pendingConfirm = null;
    $('confirm-dialog').close();
    if (action) action(value);
  });

  // ---------------------------------------------------------------- 拖拽移动分类
  var draggingId = null;

  function clearDropHighlight() {
    var marked = document.querySelectorAll('.drop-target');
    for (var i = 0; i < marked.length; i++) marked[i].classList.remove('drop-target');
  }

  /** 把条目移动到目标分类（category 为空串表示移到未分类） */
  async function moveEntry(id, category) {
    var entry = null;
    for (var i = 0; i < state.entries.length; i++) if (state.entries[i].id === id) entry = state.entries[i];
    if (entry && (entryCategory(entry) || '') === category) {
      toast(t('web.toast.alreadyThere'));
      return;
    }
    try {
      await api('/api/entries/' + encodeURIComponent(id), { method: 'PATCH', body: { extra: { category: category } } });
      toast(t('web.toast.moved', { category: catLabel(category) }));
      await refreshStatus();
      if (state.detail && state.detail.id === id) await selectEntry(id);
    } catch (error) { fail(error); }
  }

  $('list').addEventListener('dragstart', function (event) {
    var item = event.target.closest && event.target.closest('.item');
    if (!item) return;
    draggingId = item.getAttribute('data-id');
    item.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', draggingId);
  });

  $('list').addEventListener('dragend', function (event) {
    var item = event.target.closest && event.target.closest('.item');
    if (item) item.classList.remove('dragging');
    draggingId = null;
    clearDropHighlight();
  });

  $('categories').addEventListener('dragover', function (event) {
    if (!draggingId) return;
    var link = event.target.closest && event.target.closest('a[data-category]');
    if (!link || link.getAttribute('data-category') === '') return; // 「全部」不是分类
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (!link.classList.contains('drop-target')) {
      clearDropHighlight();
      link.classList.add('drop-target');
    }
  });

  $('categories').addEventListener('dragleave', function (event) {
    var link = event.target.closest && event.target.closest('a[data-category]');
    if (link) link.classList.remove('drop-target');
  });

  $('categories').addEventListener('drop', function (event) {
    var link = event.target.closest && event.target.closest('a[data-category]');
    if (!link || !draggingId) return;
    var value = link.getAttribute('data-category');
    if (value === '') return;
    event.preventDefault();
    var id = draggingId;
    draggingId = null;
    clearDropHighlight();
    var item = document.querySelector('.item.dragging');
    if (item) item.classList.remove('dragging');
    moveEntry(id, value === '__none__' ? '' : value);
  });

  // ---------------------------------------------------------------- 分类管理
  $('cat-add').addEventListener('click', function () {
    askConfirm(t('web.categoryDialog.createPrompt'), t('web.categoryDialog.create'), async function (value) {
      var name = (value || '').trim();
      if (!name) return;
      try {
        await api('/api/categories', { method: 'POST', body: { name: name } });
        state.category = name;
        toast(t('web.toast.categoryCreated'));
        await refreshStatus();
        await loadEntries();
      } catch (error) { fail(error); }
    }, { input: { label: t('web.categoryDialog.name'), value: '' } });
  });

  $('cat-rename').addEventListener('click', function () {
    var from = state.category;
    if (!from || from === '__none__') return;
    var label = catLabel(from);
    askConfirm(t('web.categoryDialog.renamePrompt', { name: label }), t('web.categoryDialog.rename'), async function (value) {
      var target = (value || '').trim();
      if (!target) return;
      try {
        await api('/api/categories/' + encodeURIComponent(from), { method: 'PATCH', body: { name: target } });
        state.category = '';
        toast(t('web.toast.categoryRenamed'));
        await refreshStatus();
      } catch (error) { fail(error); }
    }, { input: { label: t('web.categoryDialog.newName'), value: from } });
  });

  $('cat-delete').addEventListener('click', function () {
    var name = state.category;
    if (!name || name === '__none__') return;
    askConfirm(t('web.categoryDialog.deletePrompt', { name: catLabel(name) }), t('web.categoryDialog.delete'), async function () {
      try {
        await api('/api/categories/' + encodeURIComponent(name), { method: 'DELETE' });
        state.category = '';
        toast(t('web.toast.categoryDeleted'));
        await refreshStatus();
      } catch (error) { fail(error); }
    });
  });

  $('import-btn').addEventListener('click', function () {
    $('i-text').value = '';
    $('i-file').value = '';
    $('i-password').value = '';
    $('import-error').textContent = '';
    $('import-dialog').showModal();
  });
  $('import-cancel').addEventListener('click', function () { $('import-dialog').close(); });
  $('import-confirm').addEventListener('click', async function () {
    var file = $('i-file').files[0];
    var content = $('i-text').value;
    var format = 'json';
    if (file) {
      content = await file.text();
      format = /\\.csv$/i.test(file.name) ? 'csv' : 'json';
    } else {
      format = content.trim().indexOf('{') === 0 || content.trim().indexOf('[') === 0 ? 'json' : 'csv';
    }
    if (!content.trim()) { $('import-error').textContent = t('web.importDialog.needContent'); return; }
    try {
      var result = await api('/api/import', {
        method: 'POST',
        body: { content: content, format: format, password: $('i-password').value, keepDuplicates: $('i-keep').checked },
      });
      $('import-dialog').close();
      toast(t('web.importDialog.done', { n: result.imported }) + (result.skipped ? t('web.importDialog.skipped', { n: result.skipped }) : ''));
      await refreshStatus();
    } catch (error) {
      $('import-error').textContent = error.message;
    }
  });

  // ---------------------------------------------------------------- change password
  $('chpwd-btn').addEventListener('click', function () {
    $('p-old').value = ''; $('p-new').value = ''; $('p-repeat').value = '';
    $('chpwd-error').textContent = '';
    $('chpwd-dialog').showModal();
  });
  $('chpwd-cancel').addEventListener('click', function () { $('chpwd-dialog').close(); });
  $('chpwd-save').addEventListener('click', async function () {
    var oldPassword = $('p-old').value, newPassword = $('p-new').value;
    if (newPassword.length < 8) { $('chpwd-error').textContent = t('web.chpwd.tooShort'); return; }
    if (newPassword !== $('p-repeat').value) { $('chpwd-error').textContent = t('web.chpwd.mismatch'); return; }
    try {
      await api('/api/password', { method: 'POST', body: { oldPassword: oldPassword, newPassword: newPassword } });
      $('chpwd-dialog').close();
      toast(t('web.chpwd.changed'));
    } catch (error) {
      $('chpwd-error').textContent = error.message;
    }
  });

  // 应用语言（可能来自 URL / localStorage）。没有令牌时不请求接口：
  // 新标签页的 sessionStorage 是空的，需要再用终端里的完整地址打开一次。
  applyStatic();
  if (!state.token) {
    showUnlock(t('web.unlock.sessionExpired'));
  } else {
    if (LANG !== ${JSON.stringify(lang)}) {
      api('/api/lang', { method: 'POST', body: { lang: LANG } }).catch(function () {});
    }
    // 定期同步锁定状态（例如服务端自动锁定）
    pollTimer = setInterval(function () { refreshStatus(); }, 15000);
    refreshStatus();
  }
})();
</script>
</body>
</html>`
}
