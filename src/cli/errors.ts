/**
 * 命令行错误与类型的本地化。
 *
 * 插件抛出的 CliSyntaxError / 数值类型解析错误都是英文（如 missing arguments、internal.invalid-posint），
 * 且错误正文里的命令名、选项名是结构化的 —— 这里按固定句式映射回当前语言，
 * 认不出的消息原样透传，避免把信息弄丢。
 */
import type { Cli } from '@cordisjs/plugin-cli'
import type { CliSyntaxError } from '@cordisjs/plugin-cli'
import { t } from '../i18n/index.ts'

export function formatCliError(error: CliSyntaxError): string {
  const message = localizeMessage(error.message)
  return message + '\n' + t('cli.syntax.runHelp')
}

function localizeMessage(message: string): string {
  if (message === 'too many arguments') return t('cli.syntax.tooManyArguments')
  const command = /^command "(.+)" not found$/.exec(message)
  if (command) return t('cli.syntax.unknownCommand', { name: command[1]! })
  const option = /^unknown option: "(.+)"$/.exec(message)
  if (option) return t('cli.syntax.unknownOption', { name: option[1]! })
  const args = /^missing arguments: (.+)$/.exec(message)
  if (args) return t('cli.syntax.missingArguments', { names: args[1]! })
  const options = /^missing options: (.+)$/.exec(message)
  if (options) return t('cli.syntax.missingOptions', { names: options[1]! })
  return message
}

/**
 * 覆盖插件的数值类型：内置实现抛的是 internal.invalid-* 这类内部标识，
 * 这里换成带具体输入值的本地化提示（date 类型本项目未用到，保持原样）。
 */
export function defineLocalizedTypes(cli: Cli): void {
  cli.define('number', source => {
    const value = +source
    if (Number.isFinite(value)) return value
    throw new Error(t('cli.types.number', { value: source }))
  }, { numeric: true })

  cli.define('integer', source => {
    const value = +source
    if (value * 0 === 0 && Math.floor(value) === value) return value
    throw new Error(t('cli.types.integer', { value: source }))
  }, { numeric: true })

  cli.define('posint', source => {
    const value = +source
    if (value * 0 === 0 && Math.floor(value) === value && value > 0) return value
    throw new Error(t('cli.types.posint', { value: source }))
  }, { numeric: true })

  cli.define('natural', source => {
    const value = +source
    if (value * 0 === 0 && Math.floor(value) === value && value >= 0) return value
    throw new Error(t('cli.types.natural', { value: source }))
  }, { numeric: true })
}
