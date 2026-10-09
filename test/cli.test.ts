/**
 * CLI 端到端测试：真实启动 bin/pm.js，验证帮助、错误与语言选择的输出。
 * 只涉及不依赖保险库的命令（帮助 / 语法错误），不会读写任何数据文件。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const bin = fileURLToPath(new URL('../bin/pm.js', import.meta.url))

/** 干净的基线环境：清掉所有可能影响语言选择的变量 */
function baseEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, LANG: 'en_US.UTF-8', ...overrides }
  for (const name of ['PM_LANG', 'LANGUAGE', 'LC_ALL', 'LC_MESSAGES']) {
    if (!(name in overrides)) delete env[name]
  }
  return env
}

async function pm(args: string[], overrides: Record<string, string> = {}) {
  try {
    const { stdout, stderr } = await run(process.execPath, [bin, ...args], { env: baseEnv(overrides) })
    return { code: 0, stdout, stderr }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
  }
}

describe('CLI 双语输出', () => {
  it('默认跟随系统区域（LANG=en 时为英文）', async () => {
    const { code, stdout } = await pm(['--help'])
    assert.equal(code, 0)
    assert.match(stdout, /Usage: pm <command> \[options\]/)
    assert.match(stdout, /Add an entry/)
  })

  it('LANG=zh_CN.UTF-8 时输出中文，且不再出现插件的英文帮助框架', async () => {
    const { stdout } = await pm(['--help'], { LANG: 'zh_CN.UTF-8' })
    assert.match(stdout, /用法: pm <命令> \[选项\]/)
    assert.match(stdout, /添加条目/)
    assert.doesNotMatch(stdout, /Usage:|Commands:/)
  })

  it('PM_LANG 覆盖系统区域，--lang 覆盖 PM_LANG', async () => {
    assert.match((await pm(['--help'], { PM_LANG: 'zh' })).stdout, /用法:/)
    assert.match((await pm(['--help'], { PM_LANG: 'zh', LANG: 'zh_CN.UTF-8' })).stdout, /用法:/)
    assert.match((await pm(['--lang', 'en', '--help'], { PM_LANG: 'zh' })).stdout, /Usage:/)
  })

  it('具体命令的帮助也是本地化的', async () => {
    const { stdout } = await pm(['--lang', 'zh', 'help', 'add'])
    assert.match(stdout, /用法: pm add \[选项\] \[category\] \[title\]/)
    assert.match(stdout, /-u, --username/)
    assert.match(stdout, /任意额外字段 key=value，可重复/)
  })

  it('语法错误与内置帮助提示都已本地化', async () => {
    const en = await pm(['frobnicate'])
    assert.equal(en.code, 1)
    assert.match(en.stderr, /Unknown command "frobnicate"/)
    assert.match(en.stderr, /Run 'pm --help' for usage\./)

    const zh = await pm(['--lang', 'zh', 'frobnicate'])
    assert.equal(zh.code, 1)
    assert.match(zh.stderr, /未知命令 "frobnicate"/)
    assert.match(zh.stderr, /执行 'pm --help' 查看用法。/)

    const option = await pm(['get', '--nope', 'x'])
    assert.match(option.stderr, /Unknown option "nope"/)
    const missing = await pm(['get'])
    assert.match(missing.stderr, /Missing arguments: "query"/)
  })

  it('数值类型错误不再泄露 internal.invalid-*', async () => {
    const en = await pm(['gen', '-l', 'abc'])
    assert.doesNotMatch(en.stderr, /internal\./)
    assert.match(en.stderr, /Invalid positive integer: "abc"/)
    const zh = await pm(['--lang', 'zh', 'gen', '-l', 'abc'])
    assert.match(zh.stderr, /无效的正整数: "abc"/)
  })

  it('无法识别的语言会给出明确提示', async () => {
    const { code, stderr } = await pm(['--lang', 'ja', '--help'])
    assert.equal(code, 1)
    assert.match(stderr, /Unknown language "ja" \(supported: en, zh\)/)
  })

  it('--version 不受语言影响', async () => {
    const { stdout } = await pm(['--version'], { PM_LANG: 'zh' })
    assert.match(stdout, /^password-mgr \d+\.\d+\.\d+/)
  })
})
