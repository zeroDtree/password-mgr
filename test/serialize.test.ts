import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { setLocale } from '../src/i18n/index.ts'
import { exportCSV, parseCSV, parseImportCSV, parseImportJSON } from '../src/serialize.ts'
import type { Entry } from '../src/types.ts'

// 错误文案断言固定用中文，避免测试结果随运行环境的语言变化
setLocale('zh')

function entry(patch: Partial<Entry>): Entry {
  const now = new Date().toISOString()
  return {
    id: 'id-1',
    title: 'T',
    createdAt: now,
    updatedAt: now,
    ...patch,
  }
}

describe('CSV 解析', () => {
  it('处理引号、逗号与换行', () => {
    const rows = parseCSV('a,"b,1","line\nbreak","say ""hi"""\r\nx,y,z,w')
    assert.deepEqual(rows, [
      ['a', 'b,1', 'line\nbreak', 'say "hi"'],
      ['x', 'y', 'z', 'w'],
    ])
  })

  it('导出的 CSV 能被解析回来', () => {
    const entries = [
      entry({
        title: '逗号, 标题',
        username: 'u"quote',
        password: 'p\n换行',
        extra: { category: 'website', url: 'https://x.test', notes: '备注', tags: 'a|b' },
      }),
      entry({ title: '简单', extra: { category: 'email' } }),
    ]
    const rows = parseCSV(exportCSV(entries))
    assert.equal(rows.length, 3)
    assert.equal(rows[1]![1], '逗号, 标题')
    assert.equal(rows[1]![2], 'u"quote')
    assert.equal(rows[1]![3], 'p\n换行')
    assert.equal(rows[1]![6], 'a|b')
  })

  it('任意 extra 键通过 extra 列往返', () => {
    const entries = [entry({ title: 'X', extra: { category: 'apikey', SecretId: 'AKID123', 环境: '生产' } })]
    const csv = exportCSV(entries)
    assert.match(csv, /SecretId=AKID123/)
    const [parsed] = parseImportCSV(csv)
    assert.equal(parsed!.extra!.SecretId, 'AKID123')
    assert.equal(parsed!.extra!.环境, '生产')
    assert.equal(parsed!.extra!.category, 'apikey')
  })
})

describe('导入解析', () => {
  it('接受 {entries:[...]} 与裸数组', () => {
    const fromObject = parseImportJSON(JSON.stringify({ entries: [{ title: 'A', category: 'email' }] }))
    assert.equal(fromObject[0]!.title, 'A')
    assert.equal(fromObject[0]!.extra!.category, 'email')

    const fromArray = parseImportJSON(JSON.stringify([{ name: 'B' }]))
    assert.equal(fromArray[0]!.title, 'B')
    assert.equal(fromArray[0]!.extra, undefined)
  })

  it('extra 对象与旧式顶层字段都会折进 extra', () => {
    const [parsed] = parseImportJSON(JSON.stringify([{
      title: 'C',
      category: 'API_KEY',
      note: '备注',
      tags: 'x|y',
      url: 'https://c.test',
      extra: { 自定义: '值' },
    }]))
    assert.equal(parsed!.extra!.category, 'apikey')
    assert.equal(parsed!.extra!.notes, '备注')
    assert.equal(parsed!.extra!.tags, 'x|y')
    assert.equal(parsed!.extra!.url, 'https://c.test')
    assert.equal(parsed!.extra!.自定义, '值')
  })

  it('数组形式的 tags 会以 | 连接', () => {
    const [parsed] = parseImportJSON(JSON.stringify([{ title: 'D', extra: { tags: ['a', 'b'] } }]))
    assert.equal(parsed!.extra!.tags, 'a|b')
  })

  it('缺少标题时报错并给出行号', () => {
    assert.throws(() => parseImportJSON(JSON.stringify([{ title: 'ok' }, { url: 'x' }])), /第 2 条/)
  })

  it('CSV 无表头时按默认列顺序解析', () => {
    const [parsed] = parseImportCSV('website,Site,u,p,https://x,n,t1|t2')
    assert.equal(parsed!.title, 'Site')
    assert.equal(parsed!.extra!.category, 'website')
    assert.equal(parsed!.extra!.tags, 't1|t2')
  })

  it('非法 JSON 抛出解析错误', () => {
    assert.throws(() => parseImportJSON('not json'))
  })
})
