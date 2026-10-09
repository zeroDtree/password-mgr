/**
 * 本地化的帮助输出。
 *
 * @cordisjs/plugin-cli 自带的 help 命令与 Usage/Options 等框架文案都是英文且无法定制，
 * 因此这里直接基于它暴露的命令元数据（_commands/_aliases/_optionList）重新渲染，
 * 并在 commands 插件里移除内置 help、注册同名命令接管 `pm help [command]`。
 */
import type { Cli, Command } from '@cordisjs/plugin-cli'
import { t } from '../i18n/index.ts'
import { color, displayWidth, pad } from '../utils/format.ts'

const HELP_FLAGS = ['-h', '--help']

/** 判断是否为插件内置的 help 命令（用于把它摘掉，换成我们自己的） */
export function isBuiltinHelp(command: Command): boolean {
  return command.description === 'Print help for a command'
}

/**
 * 需要截获的帮助请求：返回要查看的命令路径（空数组 = 总览）。
 * 与插件原实现同样只看字面量 -h/--help，不做更细的解析。
 */
export function wantsHelp(argv: string[]): string[] | null {
  if (!argv.length) return []
  if (!argv.some(arg => HELP_FLAGS.includes(arg))) return null
  return argv.filter(arg => !HELP_FLAGS.includes(arg) && !arg.startsWith('-'))
}

export function renderHelp(cli: Cli, path: string[] = []): string {
  const resolved = resolveCommand(cli, path)
  if (path.length && !resolved) {
    return color.yellow(t('cli.help.unknownCommand', { name: path.join(' ') })) + '\n\n' + renderList(cli)
  }
  return resolved ? renderCommand(cli, resolved.command, resolved.name) : renderList(cli)
}

function resolveCommand(cli: Cli, path: string[]): { command: Command; name: string } | null {
  const first = path[0] ?? ''
  let command = cli._aliases[first]
  if (!command) return null
  let name = first
  for (const part of path.slice(1)) {
    const sub = cli._aliases[`${name}.${part}`]
    if (!sub) break
    command = sub
    name = `${name}.${part}`
  }
  return { command, name }
}

/** 顶层命令列表；同名命令保留后注册的（我们自己的 help 覆盖插件内置的那个） */
function topCommands(cli: Cli): { name: string; command: Command }[] {
  const byName = new Map<string, Command>()
  for (const command of cli._commands) {
    const name = Object.keys(command._aliases)[0]
    if (!name || name.includes('.') || command.config.hidden) continue
    byName.set(name, command)
  }
  return [...byName].map(([name, command]) => ({ name, command }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** 命令/选项的文本列宽按终端显示宽度对齐（描述里可能有中文） */
function column(entries: { label: string; description?: string }[]): string {
  const width = Math.max(...entries.map(entry => displayWidth(entry.label)))
  return entries.map(entry => {
    const label = entry.description ? pad(entry.label, width) : entry.label
    return '  ' + color.bold(color.cyan(label)) + (entry.description ? '  ' + entry.description : '')
  }).join('\n')
}

function renderList(cli: Cli): string {
  const prefix = cli.config.name ? cli.config.name + ' ' : ''
  const lines = [
    color.bold(color.green(t('cli.help.usage'))) + ' ' + prefix + t('cli.help.commandHint') + ' ' + t('cli.help.optionsHint'),
    '',
    color.bold(color.green(t('cli.help.commands'))),
    column(topCommands(cli).map(({ name, command }) => ({ label: name, description: command.description }))),
    '',
    color.bold(color.green(t('cli.help.globalOptions'))),
    column([
      { label: t('cli.help.globalFileSource'), description: t('cli.help.globalFile') },
      { label: t('cli.help.globalLangSource'), description: t('cli.help.globalLang') },
      { label: t('cli.help.globalVersionSource'), description: t('cli.help.globalVersion') },
    ]),
    '',
    t('cli.help.moreInfo'),
  ]
  return lines.join('\n')
}

function renderCommand(cli: Cli, command: Command, name: string): string {
  const displayName = [cli.config.name, name.replace(/\./g, ' ')].filter(Boolean).join(' ')
  const options = [...command._optionList].filter(option => !option.hidden)
  const lines: string[] = []

  if (command.description) lines.push(command.description, '')

  const usageParts = [color.bold(color.cyan(displayName))]
  if (options.length) usageParts.push(color.cyan(t('cli.help.optionsHint')))
  for (const arg of command._arguments) {
    usageParts.push(color.cyan(arg.required ? `<${arg.variadic ? '...' : ''}${arg.name}>` : `[${arg.variadic ? '...' : ''}${arg.name}]`))
  }
  lines.push(color.bold(color.green(t('cli.help.usage'))) + ' ' + usageParts.join(' '))

  if (command._arguments.length) {
    lines.push('', color.bold(color.green(t('cli.help.arguments'))))
    lines.push(column(command._arguments.map(arg => ({
      label: arg.required ? `<${arg.variadic ? '...' : ''}${arg.name}>` : `[${arg.variadic ? '...' : ''}${arg.name}]`,
    }))))
  }

  if (options.length) {
    lines.push('', color.bold(color.green(t('cli.help.options'))))
    lines.push(column(options.map(option => ({ label: option.source, description: option.description }))))
  }

  const aliases = Object.keys(command._aliases).slice(1)
  if (aliases.length) lines.push('', color.bold(color.green(t('cli.help.aliases'))) + ' ' + aliases.join(', '))

  return lines.join('\n')
}
