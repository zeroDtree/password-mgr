/**
 * i18n 基础设施：语言代码、复数形式与目录类型约定。
 *
 * 英文目录（en.ts）是唯一的"事实来源"，中文目录（zh.ts）按它推导出的
 * Catalog 类型声明，因此缺键、多键、层级写错都会在 `npm run typecheck` 时暴露。
 */

export type Locale = 'en' | 'zh'

export const LOCALES: readonly Locale[] = ['en', 'zh']

/** 按数量变化的词条；中文等无复数区分的语言只写 other 即可 */
export interface PluralForms {
  one?: string
  other: string
}

export type MessageValue = string | PluralForms

/** 声明一条随 {n} 变化的文案 */
export function plural(one: string, other: string): PluralForms {
  return { one, other }
}
