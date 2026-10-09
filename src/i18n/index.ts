/**
 * 界面语言：解析（命令行 > 环境变量 > 系统区域）、查表与插值。
 *
 * 进程内只有一个"当前语言"（CLI 是单次进程，Web UI 是单人本地服务，
 * 语言由启动参数决定、也可由页面上的切换器改写），因此不做请求级隔离。
 */
import { en, type Catalog } from './en.ts'
import { zh } from './zh.ts'
import type { Locale, MessageValue, PluralForms } from './core.ts'

export { LOCALES } from './core.ts'
export type { Locale } from './core.ts'

/** 只由 one/other 构成的对象才是复数词条（避免与恰好含 other 键的分组混淆） */
type IsPlural<T> = keyof T extends 'one' | 'other' ? ('other' extends keyof T ? true : false) : false

/** 目录中所有可用的点分键，如 'cli.init.desc'；写错键名会在类型检查时报错 */
type Leaves<T> = {
  [K in keyof T & string]: T[K] extends string ? K : IsPlural<T[K]> extends true ? K : `${K}.${Leaves<T[K]>}`
}[keyof T & string]

export type MessageKey = Leaves<Catalog>

type MessageParams = Record<string, string | number>
type Translator = (key: MessageKey, params?: MessageParams) => string

const catalogs: Record<Locale, Catalog> = { en, zh }
const rules = new Map<Locale, Intl.PluralRules>()
const translators = new Map<Locale, Translator>()

function isPluralForms(value: object): value is PluralForms {
  const keys = Object.keys(value)
  return keys.length > 0 && keys.every(key => key === 'one' || key === 'other')
    && typeof (value as PluralForms).other === 'string'
}

function lookup(catalog: Catalog, key: string): MessageValue | undefined {
  let node: unknown = catalog
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Record<string, unknown>)[part]
  }
  if (typeof node === 'string') return node
  return typeof node === 'object' && node !== null && isPluralForms(node) ? node : undefined
}

function interpolate(text: string, params?: MessageParams): string {
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

/** 取某个语言下的翻译函数；同语言只构造一次 */
export function translator(locale: Locale): Translator {
  const cached = translators.get(locale)
  if (cached) return cached
  const catalog = catalogs[locale]
  const translate: Translator = (key, params) => {
    const value = lookup(catalog, key) ?? lookup(en, key)
    if (value === undefined) return key
    if (typeof value === 'string') return interpolate(value, params)
    let rule = rules.get(locale)
    if (!rule) {
      rule = new Intl.PluralRules(locale)
      rules.set(locale, rule)
    }
    const forms = value as PluralForms
    const text = forms[rule.select(Number(params?.n ?? 0)) as 'one' | 'other'] ?? forms.other
    return interpolate(text, params)
  }
  translators.set(locale, translate)
  return translate
}

let current: Locale = 'en'

export function setLocale(locale: Locale): void {
  current = locale
}

export function currentLocale(): Locale {
  return current
}

/** 当前语言对应的 BCP 47 标签，用于 Intl / toLocaleString / localeCompare */
export function localeTag(locale: Locale = current): string {
  return locale === 'zh' ? 'zh-CN' : 'en'
}

/** 当前语言下的翻译 */
export function t(key: MessageKey, params?: MessageParams): string {
  return translator(current)(key, params)
}

/**
 * 把 zh_CN.UTF-8、zh-TW、EN 这类写法归一化为支持的语言；无法识别返回 undefined。
 * C/POSIX 表示"不翻译"，归一为 en；繁体中文暂时回落到简体文案（只维护一套中文）。
 */
export function normalizeLocale(input: string | undefined): Locale | undefined {
  if (!input) return undefined
  const tag = input.trim().toLowerCase().replace(/_/g, '-').replace(/[.@].*$/, '')
  if (tag === 'c' || tag === 'posix') return 'en'
  if (tag === 'cn') return 'zh'
  const base = tag.split('-')[0]
  return base === 'en' || base === 'zh' ? base : undefined
}

/** 按 POSIX 惯例探测界面语言：PM_LANG > LANGUAGE > LC_ALL > LC_MESSAGES > LANG > 系统区域 */
const ENV_LOCALES = ['PM_LANG', 'LANGUAGE', 'LC_ALL', 'LC_MESSAGES', 'LANG'] as const

export function detectLocale(env: NodeJS.ProcessEnv = process.env): Locale {
  for (const name of ENV_LOCALES) {
    const raw = env[name]
    if (!raw) continue
    for (const part of raw.split(':')) { // LANGUAGE 是按优先级排列的列表
      const locale = normalizeLocale(part)
      if (locale) return locale
    }
  }
  return normalizeLocale(Intl.DateTimeFormat().resolvedOptions().locale) ?? 'en'
}
