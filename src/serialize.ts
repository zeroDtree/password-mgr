/** 明文导入/导出的序列化（仅用于 pm export / pm import，落盘前请自行注意风险） */
import { randomUUID } from 'node:crypto'
import { t } from './i18n/index.ts'
import type { Entry, EntryInput, VaultData } from './types.ts'
import { CATEGORY_KEY, NOTES_KEY, TAGS_KEY, URL_KEY, normalizeExtra, parseCategory } from './types.ts'

export function exportJSON(data: VaultData): string {
  return JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 2)
}

/**
 * CSV 列：核心字段 + 几个约定 extra 键的便捷列 + 其余 extra 键的 extra 列。
 * extra 列写成 "k=v|k=v"（与 tags 的分隔约定一致）。
 */
const CSV_COLUMNS = ['category', 'title', 'username', 'password', 'url', 'notes', 'tags', 'extra'] as const
const EXTRA_COLUMN_KEYS = [CATEGORY_KEY, URL_KEY, NOTES_KEY, TAGS_KEY]

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`
  return value
}

function extraPairs(extra: Record<string, string> | undefined): string {
  if (!extra) return ''
  return Object.entries(extra)
    .filter(([key]) => !EXTRA_COLUMN_KEYS.includes(key))
    .map(([key, value]) => `${key}=${value}`)
    .join('|')
}

export function exportCSV(entries: Entry[]): string {
  const lines = [CSV_COLUMNS.join(',')]
  for (const entry of entries) {
    const extra = entry.extra ?? {}
    const cells: Record<typeof CSV_COLUMNS[number], string> = {
      category: extra[CATEGORY_KEY] ?? '',
      title: entry.title,
      username: entry.username ?? '',
      password: entry.password ?? '',
      url: extra[URL_KEY] ?? '',
      notes: extra[NOTES_KEY] ?? '',
      tags: extra[TAGS_KEY] ?? '',
      extra: extraPairs(entry.extra),
    }
    lines.push(CSV_COLUMNS.map(column => csvEscape(cells[column])).join(','))
  }
  return lines.join('\r\n') + '\r\n'
}

/** RFC 4180 风格 CSV 解析 */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0

  const pushField = () => { row.push(field); field = '' }
  const pushRow = () => { pushField(); rows.push(row); row = [] }

  while (i < text.length) {
    const char = text[i]!
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        quoted = false; i++; continue
      }
      field += char; i++; continue
    }
    if (char === '"' && field === '') { quoted = true; i++; continue }
    if (char === ',') { pushField(); i++; continue }
    if (char === '\r') { i++; continue }
    if (char === '\n') { pushRow(); i++; continue }
    field += char; i++
  }
  if (field !== '' || row.length) pushRow()
  return rows.filter(r => r.length > 1 || (r[0] ?? '') !== '')
}

/**
 * 以第一个 = 拆分 "key=value" 片段：键名 trim，值原样返回。
 * 无 = 时返回 undefined；键名是否允许为空、空值如何处理，由调用方决定。
 */
export function splitExtraPair(pair: string): { key: string; value: string } | undefined {
  const index = pair.indexOf('=')
  if (index <= 0) return undefined
  return { key: pair.slice(0, index).trim(), value: pair.slice(index + 1) }
}

/** 解析 "k=v|k=v" 形式的额外字段（跳过非法片段与空值） */
function parseExtraPairs(value: string | undefined): Record<string, string> {
  const extra: Record<string, string> = {}
  if (!value) return extra
  for (const pair of value.split('|')) {
    const parsed = splitExtraPair(pair)
    if (!parsed?.key) continue
    const text = parsed.value.trim()
    if (text) extra[parsed.key] = text
  }
  return extra
}

/** 分类值归一化：别名映射到规范值，认不出就原样保留 */
function normalizeCategoryValue(value: string): string {
  const trimmed = value.trim()
  return parseCategory(trimmed) ?? trimmed.toLowerCase()
}

/** 把一行里的各列合并成 extra（约定列直连，其余来自 extra 列） */
function rowToExtra(get: (name: string) => string | undefined): Record<string, string> | undefined {
  const extra: Record<string, string> = {}
  const category = get(CATEGORY_KEY)?.trim()
  if (category) extra[CATEGORY_KEY] = normalizeCategoryValue(category)
  const url = get(URL_KEY)?.trim()
  if (url) extra[URL_KEY] = url
  const notes = get(NOTES_KEY)
  if (notes) extra[NOTES_KEY] = notes
  const tags = get(TAGS_KEY)?.trim()
  if (tags) extra[TAGS_KEY] = tags
  Object.assign(extra, parseExtraPairs(get('extra')))
  return normalizeExtra(extra)
}

function finalize(input: { title?: string; username?: string; password?: string; extra?: Record<string, string> }): EntryInput {
  const title = (input.title ?? '').trim()
  if (!title) throw new Error(t('common.errors.importNoTitle'))
  const entry: EntryInput = { title }
  if (input.username) entry.username = input.username
  if (input.password) entry.password = input.password
  if (input.extra) entry.extra = input.extra
  return entry
}

/**
 * 宽松解析外部 JSON：接受 {entries:[...]} 或裸数组。
 * 条目可用 extra 对象，也可直接用 category/url/notes/tags 这些约定字段（会折进 extra）。
 */
export function parseImportJSON(text: string): EntryInput[] {
  const parsed = JSON.parse(text)
  const rawEntries: any[] = Array.isArray(parsed) ? parsed : (parsed?.entries ?? [])
  if (!Array.isArray(rawEntries)) throw new Error(t('common.errors.importBadJson'))

  return rawEntries.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new Error(t('common.errors.importNotObject', { n: index + 1 }))
    const title = String(raw.title ?? raw.name ?? '').trim()
    if (!title) throw new Error(t('common.errors.importNoTitleAt', { n: index + 1 }))

    const extra: Record<string, string> = { ...normalizeExtra(raw.extra) }
    if (extra[CATEGORY_KEY]) extra[CATEGORY_KEY] = normalizeCategoryValue(extra[CATEGORY_KEY])
    for (const key of EXTRA_COLUMN_KEYS) {
      const value = raw[key] ?? (key === NOTES_KEY ? raw.note : undefined)
      if (value === undefined || value === null || value === '') continue
      if (key === CATEGORY_KEY) extra[key] = normalizeCategoryValue(String(value))
      else extra[key] = Array.isArray(value) ? value.map(String).filter(Boolean).join('|') : String(value)
    }

    return finalize({
      title,
      username: raw.username != null ? String(raw.username) : undefined,
      password: raw.password != null ? String(raw.password) : undefined,
      extra: normalizeExtra(extra),
    })
  })
}

export function parseImportCSV(text: string): EntryInput[] {
  const rows = parseCSV(text)
  if (!rows.length) return []
  const header = rows[0]!.map(cell => cell.trim().toLowerCase())
  const hasHeader = header.includes('title') || header.includes('name')
  const columns = hasHeader ? header : [...CSV_COLUMNS]
  const body = hasHeader ? rows.slice(1) : rows

  return body.map((cells) => {
    const get = (name: string) => {
      const index = columns.indexOf(name)
      return index === -1 ? undefined : cells[index]
    }
    return finalize({
      title: get('title') ?? get('name'),
      username: get('username'),
      password: get('password'),
      extra: rowToExtra(get),
    })
  })
}

export function newEntryId(): string {
  return randomUUID()
}
