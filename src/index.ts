/**
 * 入口：解析全局参数 -> 确定界面语言 -> 组装 Cordis 应用 -> 执行 CLI 命令。
 *
 * 全局参数（建议写在命令之前；解析时会从 argv 中摘除）：
 *   -F, --file <path>   指定保险库文件（等价于环境变量 PM_VAULT）
 *   --lang <en|zh>      界面语言（等价于环境变量 PM_LANG，默认跟随系统区域）
 *   --version           打印版本
 *   --help              查看所有命令
 */
import { Context } from 'cordis'
import { Cli, CliSyntaxError, Input } from '@cordisjs/plugin-cli'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defineLocalizedTypes, formatCliError } from './cli/errors.ts'
import { renderHelp, wantsHelp } from './cli/help.ts'
import { detectLocale, LOCALES, normalizeLocale, setLocale, t, type Locale } from './i18n/index.ts'
import * as commands from './plugins/commands.ts'
import { Vault } from './plugins/vault.ts'
import { color } from './utils/format.ts'

const DEFAULT_VAULT_FILE = path.join(os.homedir(), '.password-mgr', 'vault.json')

function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

interface GlobalArgs {
  file: string
  lang: Locale | undefined
  argv: string[]
}

function parseLang(value: string): Locale {
  const locale = normalizeLocale(value)
  if (!locale) throw new Error(t('cli.lang.unknown', { value, supported: LOCALES.join(', ') }))
  return locale
}

function parseGlobalArgs(argv: string[]): GlobalArgs {
  let file = process.env.PM_VAULT ? path.resolve(process.env.PM_VAULT) : DEFAULT_VAULT_FILE
  let lang: Locale | undefined
  const rest: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--file' || arg === '-F') {
      const value = argv[++i]
      if (!value) throw new Error(t('cli.file.argRequired', { arg }))
      file = path.resolve(value)
    } else if (arg.startsWith('--file=')) {
      file = path.resolve(arg.slice('--file='.length))
    } else if (arg === '--lang') {
      const value = argv[++i]
      if (!value) throw new Error(t('cli.lang.argRequired'))
      lang = parseLang(value)
    } else if (arg.startsWith('--lang=')) {
      lang = parseLang(arg.slice('--lang='.length))
    } else {
      rest.push(arg)
    }
  }
  return { file, lang, argv: rest }
}

function fail(message: string): number {
  process.stderr.write(color.red(t('cli.errorPrefix')) + message + '\n')
  return 1
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  // 先按环境变量定语言，保证参数解析阶段的报错就已经是目标语言
  setLocale(detectLocale())

  let parsed: GlobalArgs
  try {
    parsed = parseGlobalArgs(argv)
  } catch (error) {
    return fail((error as Error).message)
  }
  if (parsed.lang) setLocale(parsed.lang)

  if (parsed.argv[0] === '--version' || parsed.argv[0] === '-v') {
    process.stdout.write(`password-mgr ${packageVersion()}\n`)
    return 0
  }

  const ctx = new Context()
  const fibers = [
    await ctx.plugin(Vault, { file: parsed.file }),
    await ctx.plugin(Cli, { name: 'pm' }),
  ]
  // 必须先于 commands：选项的类型解析函数在命令注册时就被复制走了
  defineLocalizedTypes(ctx.cli)
  fibers.push(await ctx.plugin(commands))

  try {
    // 帮助在进入命令分发前截获：插件内置的帮助文案是英文，这里统一走本地化渲染
    const helpPath = wantsHelp(parsed.argv)
    if (helpPath) {
      process.stdout.write(renderHelp(ctx.cli, helpPath) + '\n')
      return 0
    }

    const output = await ctx.cli.execute(new Input.Argv(parsed.argv))
    if (output) process.stdout.write(output + '\n')
    return 0
  } catch (error) {
    if (error instanceof CliSyntaxError) {
      return fail(formatCliError(error))
    }
    return fail((error as Error).message ?? String(error))
  } finally {
    for (const fiber of fibers.reverse()) {
      await fiber.dispose().catch(() => {})
    }
  }
}
