/** CLI 命令插件：pm init / add / ls / get / edit / rm / gen / passwd / export / import / web / info */
import { Context } from 'cordis'
import { isBuiltinHelp, renderHelp } from '../cli/help.ts'
import { generatePassword } from '../crypto.ts'
import { t, type MessageKey } from '../i18n/index.ts'
import { splitExtraPair } from '../serialize.ts'
import {
  CATEGORY_KEY, NOTES_KEY, TAGS_KEY, URL_KEY,
  categoryLabel, entryCategory, entryCategoryLabel, isBuiltinCategory, isUncategorized, parseCategory,
  type Entry, type EntryInput,
} from '../types.ts'
import { copyToClipboard } from '../utils/clipboard.ts'
import { color, displayWidth, formatDate, mask, pad, table, truncate } from '../utils/format.ts'
import { confirm, isInteractive, promptHidden, promptLine, select } from '../utils/prompt.ts'
import {
  Vault, VaultAmbiguousError, VaultError, decryptVaultFile, isVaultFileContent, type EntryPatch,
} from './vault.ts'

export const name = 'password-mgr:commands'
export const inject = ['cli', 'vault']

const CORE_FIELDS = ['id', 'title', 'username', 'password'] as const

const CATEGORY_COLORS: Record<string, (text: string) => string> = {
  email: color.cyan,
  apikey: color.magenta,
  website: color.blue,
  other: color.dim,
}

/** 自定义分类统一用一种颜色 */
function categoryColor(value: string): (text: string) => string {
  return CATEGORY_COLORS[value] ?? color.green
}

/** 约定 extra 键的展示标签 */
const EXTRA_LABEL_KEYS: Record<string, MessageKey> = {
  [CATEGORY_KEY]: 'common.extra.category',
  [URL_KEY]: 'common.extra.url',
  [NOTES_KEY]: 'common.extra.notes',
  [TAGS_KEY]: 'common.extra.tags',
}
const PREFERRED_ORDER = [CATEGORY_KEY, URL_KEY, NOTES_KEY, TAGS_KEY]

function extraLabel(key: string): string {
  const label = EXTRA_LABEL_KEYS[key]
  return label ? t(label) : key
}

function orderedExtraKeys(extra: Record<string, string>): string[] {
  const preferred = PREFERRED_ORDER.filter(key => key in extra)
  const rest = Object.keys(extra).filter(key => !PREFERRED_ORDER.includes(key)).sort()
  return [...preferred, ...rest]
}

/**
 * 交互式选择分类：列出全部已知分类 + 未分类 + 「自定义」。
 * 选自定义时当场输入名字，输入什么就是什么。
 */
async function selectCategory(known: string[]): Promise<string> {
  const CUSTOM = '__custom__'
  const choice = await select(t('cli.prompt.selectCategory'), [
    ...known.map(value => ({ value, label: categoryLabel(value) })),
    { value: 'none', label: t('common.uncategorized') },
    { value: CUSTOM, label: t('cli.prompt.customCategory') },
  ])
  if (choice === 'none') return ''
  if (choice !== CUSTOM) return choice
  const name = (await promptLine(t('cli.prompt.newCategoryName'))).trim()
  if (!name) throw new VaultError(t('cli.prompt.categoryRequired'))
  return parseCategory(name)!
}

/** 把 -e key=value 解析成对象（值为空串表示删除该键，故不 trim 值） */
function parseExtraPairs(pairs: readonly string[] | undefined): Record<string, string> {
  const extra: Record<string, string> = {}
  for (const pair of pairs ?? []) {
    const parsed = splitExtraPair(pair)
    if (!parsed) throw new VaultError(t('cli.prompt.extraPairInvalid', { pair }))
    if (!parsed.key) throw new VaultError(t('cli.prompt.extraKeyEmpty', { pair }))
    extra[parsed.key] = parsed.value
  }
  return extra
}

/** 读取主密码（非交互时从 stdin 管道读取） */
async function askMasterPassword(label = t('cli.prompt.masterPassword')): Promise<string> {
  const password = await promptHidden(`${label}: `)
  if (!password) throw new VaultError(t('cli.prompt.masterPasswordRequired'))
  return password
}

/** 确保保险库已解锁后执行操作 */
async function unlocked<T>(vault: Vault, fn: (vault: Vault) => Promise<T> | T): Promise<T> {
  if (!vault.unlocked) await vault.unlock(await askMasterPassword())
  return fn(vault)
}

/** 写导出文件并收紧权限（目标已存在时 writeFile 不会改权限，需显式 chmod） */
async function writeExportFile(target: string, content: string): Promise<void> {
  const { writeFile, chmod } = await import('node:fs/promises')
  try {
    await writeFile(target, content, { mode: 0o600 })
    await chmod(target, 0o600).catch(() => {})
  } catch (error) {
    throw new VaultError(t('cli.export.writeFailed', { target, message: (error as Error).message }))
  }
}

function categoryCell(entry: Entry): string {
  const category = entryCategory(entry)
  const label = `[${categoryLabel(category)}]`
  return category ? categoryColor(category)(label) : color.dim(label)
}

function entryLine(entry: Entry): string {
  const parts = [color.bold(entry.title)]
  if (entry.username) parts.push(color.dim(entry.username))
  const url = entry.extra?.[URL_KEY]
  if (url) parts.push(color.dim(truncate(url, 40)))
  return `${categoryCell(entry)} ${parts.join('  ')}`
}

function entryDetail(entry: Entry, show: boolean): string {
  const rows: [string, string][] = [
    [t('cli.field.id'), color.dim(entry.id)],
    [t('cli.field.title'), color.bold(entry.title)],
  ]
  if (entry.username) rows.push([t('cli.field.username'), entry.username])
  if (entry.password) {
    rows.push([t('cli.field.password'), show
      ? color.yellow(entry.password)
      : mask(entry.password) + color.dim(t('cli.field.showHint'))])
  }
  for (const key of orderedExtraKeys(entry.extra ?? {})) {
    const value = entry.extra![key]!
    if (key === CATEGORY_KEY) rows.push([extraLabel(key), entryCategoryLabel(entry)])
    else if (key === TAGS_KEY) rows.push([extraLabel(key), value.split('|').join(', ')])
    else rows.push([extraLabel(key), value])
  }
  rows.push([t('cli.field.created'), color.dim(formatDate(entry.createdAt))])
  rows.push([t('cli.field.updated'), color.dim(formatDate(entry.updatedAt))])

  const width = Math.max(...rows.map(([key]) => displayWidth(key)))
  return rows.map(([key, value]) => `${color.dim(pad(key, width))}  ${value}`).join('\n')
}

/** 交互式收集条目字段（用于 add / edit），空输入保持原值，输入 - 清空 */
async function promptEntryFields(entry: Entry | undefined, known: string[]): Promise<{ title?: string; username?: string; password?: string; extra: Record<string, string> }> {
  const extra: Record<string, string> = {}

  if (entry) {
    const current = entryCategory(entry) ?? ''
    const answer = (await promptLine(t('cli.prompt.category'), { default: current })).trim()
    // '-' 表示清空：保留空串，交给 vault.update 删除该 extra 键
    if (answer === '-') extra[CATEGORY_KEY] = ''
    else {
      const parsed = parseCategory(answer)
      if (parsed) extra[CATEGORY_KEY] = parsed
    }
  } else {
    const selected = await selectCategory(known)
    if (selected) extra[CATEGORY_KEY] = selected
  }

  const title = (await promptLine(t('cli.prompt.title'), entry ? { default: entry.title } : {})).trim()
  const username = (await promptLine(t('cli.prompt.usernameEmail'), entry ? { default: entry.username ?? '' } : {})).trim()
  const password = await promptHidden(entry
    ? t('cli.prompt.passwordKeep')
    : t('cli.prompt.passwordGenerate'))

  // 已有的额外字段逐个确认
  if (entry?.extra) {
    for (const key of orderedExtraKeys(entry.extra)) {
      if (key === CATEGORY_KEY) continue
      const value = (await promptLine(`${extraLabel(key)} [${key}]`, { default: entry.extra[key] })).trim()
      extra[key] = value === '-' ? '' : value
    }
  }

  // 追加新的额外字段
  process.stderr.write(color.dim(t('cli.prompt.extraFieldHint')))
  for (;;) {
    const line = (await promptLine(t('cli.prompt.extraField'))).trim()
    if (!line) break
    const index = line.indexOf('=')
    if (index <= 0) {
      process.stderr.write(color.red(t('cli.prompt.extraFieldFormat')))
      continue
    }
    extra[line.slice(0, index).trim()] = line.slice(index + 1)
  }

  return {
    title: title === '-' ? '' : title,
    username,
    password,
    extra,
  }
}

export function apply(ctx: Context) {
  const cli = ctx.cli

  // 插件自带的 help 是英文且无法定制文案：摘掉它，改由下面的本地化命令接管
  const builtinHelp = cli._aliases.help
  if (builtinHelp && isBuiltinHelp(builtinHelp)) builtinHelp.dispose()

  // ---------------------------------------------------------------- init
  {
    const command = cli.command('init', t('cli.init.desc'))
      .option('-f, --force', t('cli.init.force'))
    command.action(async (argv) => {
      const vault = ctx.vault
      if (vault.exists()) {
        if (!argv.options.force) {
          throw new VaultError(t('cli.init.exists', { path: vault.path }))
        }
        process.stderr.write(color.red(t('cli.init.overwriteWarn', { path: vault.path })))
        if (isInteractive() && !await confirm(t('cli.init.confirm'))) return t('common.cancelled')
      }

      process.stderr.write(color.dim(t('cli.init.hint')))
      let password = ''
      for (let attempt = 1; ; attempt++) {
        password = await askMasterPassword(t('cli.init.setPassword'))
        if (password.length < 8) {
          process.stderr.write(color.red(t('cli.init.tooShort')))
        } else {
          const repeated = await promptHidden(t('cli.prompt.repeatPassword'))
          if (password === repeated) break
          process.stderr.write(color.red(t('cli.init.mismatch')))
        }
        if (attempt >= 3) throw new VaultError(t('cli.init.tooManyAttempts'))
        process.stderr.write(color.dim(t('cli.init.retry')))
      }

      await vault.create(password, { force: true })
      const lines = [
        t('cli.init.created', { check: color.green('✓'), path: color.bold(vault.path) }),
        color.dim(t('cli.init.next')),
      ]
      if (password.length < 12) lines.push(color.yellow(t('cli.init.advice')))
      return lines.join('\n')
    })
  }

  // ---------------------------------------------------------------- add
  {
    const command = cli.command('add [category] [title]', t('cli.add.desc'))
      .option('-u, --username [value]', t('cli.add.username'))
      .option('-p, --password [value]', t('cli.add.password'))
      .option('-g, --generate', t('cli.add.generate'))
      .option('-l, --length [n]', t('cli.add.length'), { type: 'posint', default: 20 })
      .option('--url [value]', t('cli.add.url'))
      .option('-n, --note [value]', t('cli.add.note'))
      .option('-t, --tag [...tag]', t('cli.add.tag'))
      .option('-e, --extra [...pair]', t('cli.add.extra'))
    command.action(async (argv) => {
      const vault = ctx.vault
      return unlocked(vault, async () => {
        const interactive = isInteractive()
        const options = argv.options
        const hasFlags = options.username || options.password || options.generate
          || options.url || options.note || options.tag?.length || options.extra?.length

        // 裸执行 pm add：走完整向导，逐项询问
        if (!argv.args[0] && !argv.args[1] && !hasFlags && interactive) {
          const fields = await promptEntryFields(undefined, vault.categories())
          const title = fields.title?.trim()
          if (!title) throw new VaultError(t('cli.add.titleRequired'))
          const input: EntryInput = { title, extra: fields.extra }
          if (fields.username) input.username = fields.username
          if (fields.password) input.password = fields.password
          const entry = await vault.add(input)
          return t('cli.add.added', { check: color.green('✓'), entry: entryLine(entry) })
        }

        const rawCategory = argv.args[0]
        // 分类是自由字符串：内置的四个只是建议值，写别的就是自定义分类
        let category = rawCategory ? parseCategory(rawCategory) : undefined
        if (rawCategory && !category) throw new VaultError(t('cli.prompt.categoryRequired'))

        let title = argv.args[1]?.trim()
        if (!category && interactive) category = await selectCategory(vault.categories()) || undefined
        if (rawCategory && isUncategorized(rawCategory)) throw new VaultError(t('cli.add.categoryRequired'))
        if (!title && interactive) title = (await promptLine(t('cli.prompt.title'))).trim()
        if (!title) throw new VaultError(t('cli.add.titleRequired'))

        const input: EntryInput = { title }
        if (category) input.extra = { ...input.extra, [CATEGORY_KEY]: category }
        if (argv.options.username) input.username = argv.options.username
        if (argv.options.url) input.extra = { ...input.extra, [URL_KEY]: argv.options.url }
        if (argv.options.note) input.extra = { ...input.extra, [NOTES_KEY]: argv.options.note }
        if (argv.options.tag?.length) input.extra = { ...input.extra, [TAGS_KEY]: argv.options.tag.join('|') }
        if (argv.options.extra?.length) input.extra = { ...input.extra, ...parseExtraPairs(argv.options.extra) }

        if (argv.options.generate) {
          input.password = generatePassword({ length: argv.options.length })
        } else if (argv.options.password !== undefined) {
          input.password = argv.options.password
        } else if (interactive) {
          const password = await promptHidden(t('cli.prompt.passwordGenerate'))
          input.password = password || generatePassword({ length: argv.options.length })
        }

        const entry = await vault.add(input)
        return t('cli.add.added', { check: color.green('✓'), entry: entryLine(entry) })
      })
    })
  }

  // ---------------------------------------------------------------- ls
  {
    const command = cli.command('ls [category]', t('cli.ls.desc'))
      .option('-q, --query [keyword]', t('cli.ls.query'))
      .option('--json', t('cli.ls.json'))
    command.alias('list', {})
    command.action(async (argv) => {
      const vault = ctx.vault
      return unlocked(vault, async () => {
        const rawCategory = argv.args[0]
        let filter: { category?: string; uncategorized?: boolean } = {}
        if (rawCategory) {
          if (isUncategorized(rawCategory)) filter = { uncategorized: true }
          else {
            const category = parseCategory(rawCategory)
            if (!category) throw new VaultError(t('cli.ls.unknownCategory', {
              name: rawCategory,
              uncategorized: t('common.uncategorized'),
            }))
            filter = { category }
          }
        }

        const entries = vault.list({ ...filter, query: argv.options.query })
        if (argv.options.json) return JSON.stringify(entries, null, 2)
        if (!entries.length) return color.dim(t('cli.ls.empty'))

        const rows = entries.map(entry => [
          entryCategoryLabel(entry),
          entry.title,
          entry.username ?? '',
          entry.extra?.[URL_KEY] ? truncate(entry.extra[URL_KEY], 36) : '',
          color.dim(formatDate(entry.updatedAt)),
        ])
        return table([
          t('cli.ls.headerCategory'), t('cli.ls.headerTitle'), t('cli.ls.headerUsername'),
          t('cli.ls.headerUrl'), t('cli.ls.headerUpdated'),
        ], rows) + '\n' + color.dim(t('cli.ls.count', { n: entries.length }))
      })
    })
  }

  // ---------------------------------------------------------------- get
  {
    const command = cli.command('get <query>', t('cli.get.desc'))
      .option('-f, --field [name]', t('cli.get.field'))
      .option('-s, --show', t('cli.get.show'))
      .option('-c, --copy', t('cli.get.copy'))
      .option('--json', t('cli.get.json'))
    command.alias('show', {})
    command.action(async (argv) => {
      const vault = ctx.vault
      return unlocked(vault, async () => {
        const field = argv.options.field?.trim()
        const entry = await resolveEntry(vault, argv.args[0])
        if (argv.options.json) return JSON.stringify(entry, null, 2)

        if (field) {
          if ((CORE_FIELDS as readonly string[]).includes(field)) {
            return String(entry[field as typeof CORE_FIELDS[number]] ?? '')
          }
          return entry.extra?.[field] ?? ''
        }

        if (argv.options.copy) {
          if (!entry.password) throw new VaultError(t('cli.get.noPassword', { title: entry.title }))
          const tool = await copyToClipboard(entry.password)
          return t('cli.get.copied', {
            check: color.green('✓'), title: color.bold(entry.title), tool,
          }) + '\n' + color.dim(t('cli.get.clipboardWarn'))
        }

        return entryDetail(entry, argv.options.show ?? false)
      })
    })
  }

  // ---------------------------------------------------------------- cp
  {
    const command = cli.command('cp <query>', t('cli.cp.desc'))
    command.action(async (argv) => {
      const vault = ctx.vault
      return unlocked(vault, async () => {
        const entry = await resolveEntry(vault, argv.args[0])
        if (!entry.password) throw new VaultError(t('cli.get.noPassword', { title: entry.title }))
        const tool = await copyToClipboard(entry.password)
        return t('cli.get.copied', { check: color.green('✓'), title: color.bold(entry.title), tool })
      })
    })
  }

  // ---------------------------------------------------------------- edit
  {
    const command = cli.command('edit <query>', t('cli.edit.desc'))
      .option('--title [value]', t('cli.edit.title'))
      .option('--category [name]', t('cli.edit.category'))
      .option('-u, --username [value]', t('cli.edit.username'))
      .option('-p, --password [value]', t('cli.edit.password'))
      .option('-g, --generate', t('cli.edit.generate'))
      .option('-l, --length [n]', t('cli.edit.length'), { type: 'posint', default: 20 })
      .option('--url [value]', t('cli.edit.url'))
      .option('-n, --note [value]', t('cli.edit.note'))
      .option('-t, --tag [...tag]', t('cli.edit.tag'))
      .option('-e, --extra [...pair]', t('cli.edit.extra'))
      .option('--clear [...field]', t('cli.edit.clear'))
    command.action(async (argv) => {
      const vault = ctx.vault
      return unlocked(vault, async () => {
        const entry = await resolveEntry(vault, argv.args[0])
        const patch: EntryPatch = {}
        const extra: Record<string, string> = {}
        const options = argv.options

        for (const field of options.clear ?? []) {
          if (field === 'title' || field === 'id') throw new VaultError(t('cli.edit.cannotClear', { field }))
          if (field === 'username' || field === 'password') patch[field] = ''
          else extra[field] = ''
        }

        if (options.title !== undefined) patch.title = options.title
        if (options.category !== undefined) {
          if (isUncategorized(options.category)) extra[CATEGORY_KEY] = ''
          else {
            const category = parseCategory(options.category)
            if (!category) throw new VaultError(t('cli.edit.unknownCategory', { name: options.category }))
            extra[CATEGORY_KEY] = category
          }
        }
        if (options.username !== undefined) patch.username = options.username
        if (options.password !== undefined) patch.password = options.password
        else if (options.generate) patch.password = generatePassword({ length: options.length })
        if (options.url !== undefined) extra[URL_KEY] = options.url
        if (options.note !== undefined) extra[NOTES_KEY] = options.note
        if (options.tag?.length) extra[TAGS_KEY] = options.tag.join('|')
        Object.assign(extra, parseExtraPairs(options.extra))

        if (!Object.keys(patch).length && !Object.keys(extra).length) {
          if (!isInteractive()) throw new VaultError(t('cli.edit.nonInteractive'))
          process.stderr.write(color.dim(t('cli.edit.interactiveHint')))
          const fields = await promptEntryFields(entry, vault.categories())
          if (fields.title !== undefined) patch.title = fields.title
          if (fields.username !== undefined) patch.username = fields.username
          if (fields.password !== undefined) patch.password = fields.password
          // 交互结果写回 patch：空串表示清空，由 vault.update 删除该键
          Object.assign(extra, fields.extra)
        }

        if (Object.keys(extra).length) patch.extra = extra
        const updated = await vault.update(entry.id, patch)
        return t('cli.edit.updated', { check: color.green('✓') }) + '\n' + entryDetail(updated, false)
      })
    })
  }

  // ---------------------------------------------------------------- rm
  {
    const command = cli.command('rm <query>', t('cli.rm.desc'))
    command.alias('remove', {})
    command.action(async (argv) => {
      const vault = ctx.vault
      return unlocked(vault, async () => {
        const entry = await resolveEntry(vault, argv.args[0])
        if (isInteractive() && !await confirm(t('cli.rm.confirm', { entry: entryLine(entry) }))) return t('common.cancelled')
        await vault.remove(entry.id)
        return t('cli.rm.removed', { check: color.green('✓'), title: color.bold(entry.title) })
      })
    })
  }

  // ---------------------------------------------------------------- gen
  {
    const command = cli.command('gen', t('cli.gen.desc'))
      .option('-l, --length [n]', t('cli.gen.length'), { type: 'posint', default: 20 })
      .option('-c, --count [n]', t('cli.gen.count'), { type: 'posint', default: 1 })
      .option('--no-lower', t('cli.gen.noLower'))
      .option('--no-upper', t('cli.gen.noUpper'))
      .option('--no-digits', t('cli.gen.noDigits'))
      .option('--no-symbols', t('cli.gen.noSymbols'))
      .option('--no-ambiguous', t('cli.gen.noAmbiguous'))
      .option('--copy', t('cli.gen.copy'))
    command.action(async (argv) => {
      const options = argv.options
      const generated = Array.from({ length: options.count ?? 1 }, () => generatePassword({
        length: options.length,
        lowercase: !options.noLower,
        uppercase: !options.noUpper,
        digits: !options.noDigits,
        symbols: !options.noSymbols,
        excludeAmbiguous: options.noAmbiguous ?? false,
      }))
      if (options.copy) {
        if (generated.length !== 1) throw new VaultError(t('cli.gen.copyOne'))
        const tool = await copyToClipboard(generated[0]!)
        return t('cli.gen.copied', {
          check: color.green('✓'), tool, password: color.yellow(generated[0]!),
        })
      }
      return generated.join('\n')
    })
  }

  // ---------------------------------------------------------------- passwd
  {
    const command = cli.command('passwd', t('cli.passwd.desc'))
    command.action(async () => {
      const vault = ctx.vault
      const oldPassword = await askMasterPassword(t('cli.passwd.current'))
      const newPassword = await askMasterPassword(t('cli.passwd.next'))
      if (newPassword.length < 8) throw new VaultError(t('cli.passwd.tooShort'))
      const repeated = await promptHidden(t('cli.prompt.repeatPassword'))
      if (newPassword !== repeated) throw new VaultError(t('cli.passwd.mismatch'))

      await vault.changePassword(oldPassword, newPassword)
      return t('cli.passwd.changed', { check: color.green('✓') })
    })
  }

  // ---------------------------------------------------------------- export
  {
    const command = cli.command('export [file]', t('cli.export.desc'))
      .option('--format [name]', t('cli.export.format'), { default: 'json' })
    command.action(async (argv) => {
      const vault = ctx.vault
      const format = argv.options.format?.toLowerCase() ?? 'json'
      if (format !== 'json' && format !== 'csv' && format !== 'vault') {
        throw new VaultError(t('cli.export.badFormat'))
      }
      const target = argv.args[0]

      // 加密副本就是保险库文件本身，复制无需解密，因此不必输入主密码
      if (format === 'vault') {
        const content = await vault.exportBackup()
        if (!target) return content
        await writeExportFile(target, content)
        return t('cli.export.vaultDone', { check: color.green('✓'), target: color.bold(target) }) + '\n'
          + color.dim(t('cli.export.vaultNote'))
      }

      return unlocked(vault, async () => {
        const content = vault.export(format)
        if (!target) return content
        await writeExportFile(target, content)
        return t('cli.export.done', { check: color.green('✓'), n: vault.count(), target: color.bold(target) }) + '\n'
          + color.red(t('cli.export.plaintextWarn'))
      })
    })
  }

  // ---------------------------------------------------------------- import
  {
    const command = cli.command('import <file>', t('cli.import.desc'))
      .option('--format [name]', t('cli.import.format'))
      .option('--keep-duplicates', t('cli.import.keepDuplicates'))
    command.action(async (argv) => {
      const vault = ctx.vault
      return unlocked(vault, async () => {
        const file = argv.args[0]!
        const { readFile } = await import('node:fs/promises')
        let content: string
        try {
          content = await readFile(file, 'utf8')
        } catch {
          throw new VaultError(t('cli.import.unreadable', { file }))
        }

        let inputs: EntryInput[]
        if (isVaultFileContent(content)) {
          // pmvault 加密备份：用该文件的主密码解密后合并导回
          const password = await promptHidden(t('cli.import.backupPassword'))
          if (!password) throw new VaultError(t('cli.import.backupPasswordRequired'))
          inputs = decryptVaultFile(content, password).entries
        } else {
          const format = argv.options.format?.toLowerCase()
            ?? (file.toLowerCase().endsWith('.csv') ? 'csv' : 'json')
          if (format !== 'json' && format !== 'csv') throw new VaultError(t('cli.import.badFormat'))
          inputs = vault.parseImport(content, format)
        }
        const result = await vault.import(inputs, { skipDuplicates: !argv.options.keepDuplicates })
        let output = t('cli.import.done', { check: color.green('✓'), n: result.imported })
        if (result.skipped) output += t('cli.import.skipped', { n: result.skipped })
        return output
      })
    })
  }

  // ---------------------------------------------------------------- cat
  {
    const command = cli.command('cat [action] [name] [value]', t('cli.cat.desc'))
    command.action(async (argv) => {
      const vault = ctx.vault
      return unlocked(vault, async () => {
        const action = (argv.args[0] ?? 'list').toLowerCase()
        const name = argv.args[1]
        const value = argv.args[2]

        if (action === 'list' || action === 'ls') {
          const stats = vault.stats()
          const rows = vault.categories().map(category => {
            const count = stats.byCategory[category] ?? 0
            return [
              categoryLabel(category),
              color.dim(category),
              isBuiltinCategory(category) ? color.dim(t('cli.cat.builtin')) : color.green(t('cli.cat.custom')),
              String(count),
            ]
          })
          rows.push([t('common.uncategorized'), color.dim('-'), color.dim('-'), String(stats.uncategorized)])
          return table([
            t('cli.cat.headerCategory'), t('cli.cat.headerValue'),
            t('cli.cat.headerType'), t('cli.cat.headerCount'),
          ], rows) + '\n' + color.dim(t('cli.cat.hint'))
        }

        if (action === 'add') {
          if (!name) throw new VaultError(t('cli.cat.usageAdd'))
          const before = vault.categories().length
          const list = await vault.registerCategory(name)
          const category = parseCategory(name)!
          if (list.length === before) return color.dim(t('cli.cat.exists', { name: categoryLabel(category) }))
          return t('cli.cat.added', { check: color.green('✓'), name: color.bold(categoryLabel(category)) })
        }

        if (action === 'rm' || action === 'remove' || action === 'delete') {
          if (!name) throw new VaultError(t('cli.cat.usageRm'))
          const category = parseCategory(name)!
          const count = vault.count(category)
          if (count && isInteractive() && !await confirm(t('cli.cat.removeConfirm', {
            name: color.bold(categoryLabel(category)), n: count,
          }))) return t('common.cancelled')
          const result = await vault.deleteCategory(category)
          return t('cli.cat.removed', { check: color.green('✓'), name: color.bold(categoryLabel(category)) })
            + (result.entries ? t('cli.cat.removedEntries', { n: result.entries }) : '')
            + color.dim(t('cli.cat.restoreHint'))
        }

        if (action === 'rename' || action === 'mv') {
          if (!name || !value) throw new VaultError(t('cli.cat.usageRename'))
          const result = await vault.renameCategory(name, value)
          return t('cli.cat.renamed', {
            check: color.green('✓'),
            from: categoryLabel(parseCategory(name)!),
            to: color.bold(categoryLabel(parseCategory(value)!)),
          }) + (result.entries ? t('cli.cat.renamedEntries', { n: result.entries }) : '')
        }

        throw new VaultError(t('cli.cat.unknownAction', { action }))
      })
    })
  }

  // ---------------------------------------------------------------- info
  {
    const command = cli.command('info', t('cli.info.desc'))
    command.action(() => {
      const vault = ctx.vault
      if (!vault.exists()) {
        return color.yellow(t('cli.info.notCreated')) + '\n'
          + t('cli.info.path', { path: vault.path }) + '\n'
          + t('cli.info.initHint', { command: color.bold('pm init') })
      }
      const stats = vault.unlocked ? vault.stats() : null
      const labels = [t('cli.info.pathLabel'), t('cli.info.statusLabel'), t('cli.info.entriesLabel')]
      const width = Math.max(...labels.map(displayWidth))
      const row = (label: string, value: string) => `${pad(label, width)}  ${value}`
      const lines = [
        row(labels[0]!, vault.path),
        row(labels[1]!, vault.unlocked ? color.green(t('cli.info.unlocked')) : color.yellow(t('cli.info.locked'))),
        row(labels[2]!, stats ? String(stats.total) : color.dim(t('cli.info.afterUnlock'))),
      ]
      if (stats) {
        const names = [...vault.categories(), t('common.uncategorized')]
        const catWidth = Math.max(...names.map(displayWidth))
        for (const category of vault.categories()) {
          lines.push(`  ${pad(categoryLabel(category), catWidth)}${stats.byCategory[category] ?? 0}`)
        }
        if (stats.uncategorized) lines.push(`  ${pad(t('common.uncategorized'), catWidth)}${stats.uncategorized}`)
      }
      return lines.join('\n')
    })
  }

  // ---------------------------------------------------------------- web
  {
    const command = cli.command('web', t('cli.web.desc'))
      .option('-p, --port [n]', t('cli.web.port'), { type: 'posint', default: 3170 })
      .option('--host [addr]', t('cli.web.host'), { default: '127.0.0.1' })
      .option('--auto-lock [minutes]', t('cli.web.autoLock'), { type: 'posint', default: 10 })
      .option('--open', t('cli.web.open'), { default: true })
    command.action(async (argv) => {
      const host = argv.options.host?.trim()
      // 空地址会被 Node 解释为"监听所有网卡"，必须拦下
      if (!host) throw new VaultError(t('cli.web.hostRequired'))
      if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
        if (isInteractive() && !await confirm(
          color.red(t('cli.web.exposeConfirm', { host })),
        )) {
          return t('common.cancelled')
        }
      }
      const [{ default: Server }, { default: Web }] = await Promise.all([
        import('@cordisjs/plugin-server'),
        import('./web.ts'),
      ])
      const serverFiber = await ctx.plugin(Server, {
        host,
        port: argv.options.port ?? 3170,
      })
      const webFiber = await ctx.plugin(Web, {
        autoLockMinutes: argv.options.autoLock,
        open: argv.options.open ?? false,
      })

      await new Promise<void>((resolve) => {
        const onSignal = () => {
          process.stderr.write('\n' + color.dim(t('cli.web.stopping')))
          // 再按一次 Ctrl+C 强制退出
          process.once('SIGINT', () => process.exit(130))
          resolve()
        }
        process.once('SIGINT', onSignal)
        process.once('SIGTERM', onSignal)
      })

      await webFiber.dispose()
      await serverFiber.dispose()
      return color.dim(t('cli.web.stopped'))
    })
  }

  // ---------------------------------------------------------------- help
  {
    const command = cli.command('help [command]', t('cli.help.desc'))
    command.action((argv) => renderHelp(cli, argv.args[0] ? [argv.args[0]] : []))
  }
}

/** 把 query 解析为唯一条目；多个匹配时在交互模式下让用户选择 */
async function resolveEntry(vault: Vault, query: string): Promise<Entry> {
  if (!query) throw new VaultError(t('cli.entry.noQuery'))
  try {
    return vault.resolve(query)
  } catch (error) {
    if (!(error instanceof VaultAmbiguousError) || !isInteractive()) throw error
    const chosen = await select(t('cli.entry.ambiguous', { query }), error.matches.map(entry => ({
      value: entry.id,
      label: `${entryCategoryLabel(entry)} ${entry.title}${entry.username ? ' / ' + entry.username : ''}`,
    })))
    return vault.getById(chosen)!
  }
}
