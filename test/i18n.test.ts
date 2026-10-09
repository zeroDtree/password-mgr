import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { en } from '../src/i18n/en.ts'
import { zh } from '../src/i18n/zh.ts'
import {
  LOCALES, currentLocale, detectLocale, localeTag, normalizeLocale, setLocale, t, translator,
} from '../src/i18n/index.ts'

/** 把嵌套目录摊平成 key -> 文案 / 复数形式 */
function flatten(value: unknown, prefix = ''): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof item === 'string') result.set(path, [item])
    else if (item && typeof item === 'object') {
      const forms = Object.values(item as Record<string, unknown>)
      if (forms.every(form => typeof form === 'string')) result.set(path, forms as string[])
      else for (const [sub, texts] of flatten(item, path)) result.set(sub, texts)
    }
  }
  return result
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]!).sort()
}

const enFlat = flatten(en)
const zhFlat = flatten(zh)

describe('文案目录', () => {
  it('中英目录的键一一对应', () => {
    assert.deepEqual([...zhFlat.keys()].sort(), [...enFlat.keys()].sort())
  })

  it('没有空文案，且同一词条在两种语言里的占位符一致', () => {
    for (const [key, texts] of enFlat) {
      assert.ok(texts.length > 0 && texts.every(text => text.trim()), `${key} 不应为空`)
      const translated = zhFlat.get(key)!
      assert.ok(translated.length > 0 && translated.every(text => text.trim()), `${key} 中文不应为空`)
      assert.deepEqual(
        placeholders(translated[translated.length - 1]!),
        placeholders(texts[texts.length - 1]!),
        `${key} 的占位符应与英文一致`,
      )
    }
  })

  it('英文复数按 Intl.PluralRules 选择，中文只有一种形式', () => {
    const translate = translator('en')
    assert.equal(translate('cli.ls.count', { n: 1 }), '1 entry')
    assert.equal(translate('cli.ls.count', { n: 5 }), '5 entries')
    assert.equal(translator('zh')('cli.ls.count', { n: 1 }), '共 1 条')
    assert.equal(translator('zh')('cli.ls.count', { n: 5 }), '共 5 条')
  })

  it('占位符插值保留未知占位符，不会拼出 undefined', () => {
    const translate = translator('en')
    assert.equal(translate('cli.init.created', { check: 'ok', path: '/tmp/v.json' }), 'ok Vault created: /tmp/v.json')
    assert.equal(translate('cli.field.id', { unknown: 1 }), 'ID')
  })

  it('setLocale / currentLocale 全局生效', () => {
    assert.equal(currentLocale(), 'en')
    setLocale('zh')
    assert.equal(currentLocale(), 'zh')
    assert.equal(t('cli.field.title'), '标题')
    setLocale('en')
    assert.equal(t('cli.field.title'), 'Title')
  })
})

describe('语言探测', () => {
  it('归一化常见写法', () => {
    assert.equal(normalizeLocale('zh_CN.UTF-8'), 'zh')
    assert.equal(normalizeLocale('zh-TW'), 'zh')
    assert.equal(normalizeLocale('en_US.UTF-8'), 'en')
    assert.equal(normalizeLocale('CN'), 'zh')
    assert.equal(normalizeLocale('C'), 'en')
    assert.equal(normalizeLocale('POSIX'), 'en')
    assert.equal(normalizeLocale('ja_JP.UTF-8'), undefined)
    assert.equal(normalizeLocale(''), undefined)
  })

  it('按 PM_LANG > LANGUAGE > LC_ALL > LC_MESSAGES > LANG 的优先级探测', () => {
    assert.equal(detectLocale({}), 'en')
    assert.equal(detectLocale({ LANG: 'zh_CN.UTF-8' }), 'zh')
    assert.equal(detectLocale({ LANG: 'zh_CN.UTF-8', LC_MESSAGES: 'en_US.UTF-8' }), 'en')
    assert.equal(detectLocale({ LANG: 'zh_CN.UTF-8', LC_ALL: 'en_US.UTF-8', PM_LANG: 'zh' }), 'zh')
    // LANGUAGE 是按优先级排列的列表，跳过不支持的语言
    assert.equal(detectLocale({ LANGUAGE: 'ja:zh' }), 'zh')
    // LC_ALL=C 表示不翻译
    assert.equal(detectLocale({ LANG: 'zh_CN.UTF-8', LC_ALL: 'C' }), 'en')
  })

  it('localeTag 用于 Intl 相关调用', () => {
    assert.equal(localeTag('zh'), 'zh-CN')
    assert.equal(localeTag('en'), 'en')
  })

  it('支持的语言列表与目录一致', () => {
    assert.deepEqual([...LOCALES], ['en', 'zh'])
  })
})
