/**
 * 条目模型：核心只有 标题 / 用户名 / 密码，其余一切都是 extra 里的自由键值。
 * 分类是 extra.category，取值本身就是自由字符串 —— 内置的四个只是
 * "建议值 + 展示标签"，用户随时可以新增、重命名、删除自己的分类。
 */
import { t, type MessageKey } from './i18n/index.ts'

/** 约定的 extra 键名 */
export const CATEGORY_KEY = 'category'
export const URL_KEY = 'url'
export const NOTES_KEY = 'notes'
export const TAGS_KEY = 'tags'

/** 内置分类：作为默认建议值，不可删除 */
export const BUILTIN_CATEGORIES = ['email', 'apikey', 'website', 'other'] as const

const CATEGORY_LABEL_KEYS: Record<string, MessageKey> = {
  email: 'common.category.email',
  apikey: 'common.category.apikey',
  website: 'common.category.website',
  other: 'common.category.other',
}

/** 命令行与 Web 输入里允许的别名（中英文均可），映射到内置分类 */
const CATEGORY_ALIASES: Record<string, string> = {
  email: 'email', mail: 'email', 邮箱: 'email', 邮件: 'email',
  apikey: 'apikey', api: 'apikey', 'api-key': 'apikey', 'api_key': 'apikey', key: 'apikey', 密钥: 'apikey',
  website: 'website', web: 'website', site: 'website', 网站: 'website', 网页: 'website',
  other: 'other', misc: 'other', 其他: 'other', 其它: 'other',
}

/**
 * 解析用户输入的分类：已知别名归一化到内置值，其余原样作为自定义分类。
 * 返回 undefined 表示空输入（即未分类）。
 */
export function parseCategory(input: string): string | undefined {
  const trimmed = input.trim()
  if (!trimmed) return undefined
  return CATEGORY_ALIASES[trimmed.toLowerCase()] ?? trimmed
}

/** 未分类的筛选别名（中英文输入都接受，与界面语言无关） */
export function isUncategorized(input: string): boolean {
  const value = input.trim().toLowerCase()
  return value === 'none' || value === 'uncategorized' || value === '未分类'
}

export function isBuiltinCategory(value: string): boolean {
  return (BUILTIN_CATEGORIES as readonly string[]).includes(value)
}

export interface Entry {
  id: string
  title: string
  username?: string
  password?: string
  /** 任意附加字段，值一律为字符串 */
  extra?: Record<string, string>
  createdAt: string
  updatedAt: string
}

export type EntryInput = Omit<Entry, 'id' | 'createdAt' | 'updatedAt'>
  & Partial<Pick<Entry, 'id' | 'createdAt' | 'updatedAt'>>

export interface VaultSettings {
  /** 用户显式登记的分类，独立于条目存在（内置分类无需登记） */
  categories?: string[]
  /** 被用户移除的分类（含内置分类），不再出现在分类列表里 */
  hidden?: string[]
}

export interface VaultData {
  version: 2
  entries: Entry[]
  settings?: VaultSettings
}

export function entryCategory(entry: Entry): string | undefined {
  const value = entry.extra?.[CATEGORY_KEY]?.trim()
  return value || undefined
}

/** 分类的展示名：内置分类走文案目录，自定义分类原样显示 */
export function categoryLabel(value: string | undefined): string {
  const key = value ? CATEGORY_LABEL_KEYS[value] : undefined
  return key ? t(key) : value || t('common.uncategorized')
}

export function entryCategoryLabel(entry: Entry): string {
  return categoryLabel(entryCategory(entry))
}

/** 清洗 extra：去掉空值，值统一转成字符串 */
export function normalizeExtra(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const extra: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const name = key.trim()
    if (!name || value === undefined || value === null) continue
    const text = Array.isArray(value) ? value.map(String).filter(Boolean).join('|') : String(value)
    if (text !== '') extra[name] = text
  }
  return Object.keys(extra).length ? extra : undefined
}
