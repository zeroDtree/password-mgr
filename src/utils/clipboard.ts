/** 跨平台剪贴板写入（调用系统命令，不引入依赖） */
import { spawn } from 'node:child_process'
import { t } from '../i18n/index.ts'

function candidates(): [string, string[]][] {
  switch (process.platform) {
    case 'darwin':
      return [['pbcopy', []]]
    case 'win32':
      return [['clip', []]]
    default:
      return [
        ['wl-copy', []],
        ['xclip', ['-selection', 'clipboard']],
        ['xsel', ['--clipboard', '--input']],
      ]
  }
}

/** 成功返回所用命令名，失败抛错 */
export async function copyToClipboard(text: string): Promise<string> {
  const errors: string[] = []
  for (const [command, args] of candidates()) {
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'ignore'] })
        child.on('error', reject)
        child.on('close', code => (code === 0 ? resolve() : reject(new Error(t('common.errors.clipboardExit', { command, code: code ?? 0 })))))
        child.stdin.on('error', reject)
        child.stdin.end(text)
      })
      return command
    } catch (error) {
      errors.push(`${command}: ${(error as Error).message}`)
    }
  }
  throw new Error(t('common.errors.clipboardMissing') + '\n' + errors.join('\n'))
}
