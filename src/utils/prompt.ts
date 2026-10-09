/** 终端交互：隐藏输入密码、普通输入、确认、单选。提示信息一律写 stderr，stdout 留给数据。 */
import { createInterface } from 'node:readline/promises'
import { StringDecoder } from 'node:string_decoder'
import { t } from '../i18n/index.ts'

export function isInteractive(): boolean {
  return process.stdin.isTTY === true
}

/**
 * 非交互场景（管道）下按行读取 stdin。
 * 用常驻队列实现，多次读取（如 init 需要输入两次密码）不会丢数据。
 */
let lineQueue: string[] = []
let pendingLine: ((line: string) => void)[] = []
let stdinBuffer = ''
let stdinEnded = false
let stdinStarted = false

function startStdinReader() {
  if (stdinStarted) return
  stdinStarted = true
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk: string) => {
    stdinBuffer += chunk
    let index: number
    while ((index = stdinBuffer.indexOf('\n')) !== -1) {
      const line = stdinBuffer.slice(0, index).replace(/\r$/, '')
      stdinBuffer = stdinBuffer.slice(index + 1)
      const waiter = pendingLine.shift()
      if (waiter) waiter(line)
      else lineQueue.push(line)
    }
  })
  process.stdin.on('end', () => {
    stdinEnded = true
    if (stdinBuffer) {
      lineQueue.push(stdinBuffer.replace(/\r$/, ''))
      stdinBuffer = ''
    }
    for (const waiter of pendingLine.splice(0)) waiter('')
  })
  process.stdin.resume()
}

async function readLineFromStdin(): Promise<string> {
  startStdinReader()
  const queued = lineQueue.shift()
  if (queued !== undefined) return queued
  if (stdinEnded) return ''
  return new Promise<string>(resolve => pendingLine.push(resolve))
}

/** 不回显地读取输入（主密码用） */
export async function promptHidden(label: string): Promise<string> {
  if (!process.stdin.isTTY) return readLineFromStdin()

  return new Promise<string>((resolve) => {
    const stdin = process.stdin
    const wasRaw = stdin.isRaw
    // 先切到 raw 模式并挂好监听，再打印提示，避免用户抢先输入时丢字符
    stdin.setRawMode(true)
    stdin.resume()

    let value = ''
    // 0=正常 1=刚收到 ESC 2=正在吞 CSI/SS3 序列
    let escapeState = 0
    // 按 UTF-8 增量解码，避免多字节字符被切在两个数据块之间
    const decoder = new StringDecoder('utf8')

    const cleanup = () => {
      stdin.setRawMode(wasRaw ?? false)
      stdin.pause()
      stdin.off('data', onData)
    }
    const onData = (chunk: Buffer) => {
      for (const char of decoder.write(chunk)) {
        // 方向键/Home/Delete 等会发来 ESC 开头的转义序列，整段丢弃，
        // 否则 "[A" 这类字节会被当成密码内容
        if (escapeState === 1) {
          escapeState = char === '[' || char === 'O' ? 2 : 0
          continue
        }
        if (escapeState === 2) {
          const code = char.codePointAt(0)!
          if (code >= 0x40 && code <= 0x7e) escapeState = 0 // 终字节
          continue
        }
        if (char === '\u001b') {
          escapeState = 1
          continue
        }
        if (char === '\r' || char === '\n') {
          cleanup()
          process.stderr.write('\n')
          resolve(value)
          return
        }
        if (char === '\u0003') { // Ctrl+C
          cleanup()
          process.stderr.write('\n')
          process.exit(130)
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1)
          continue
        }
        if (char === '\u0015') { // Ctrl+U 清空
          value = ''
          continue
        }
        if (char >= ' ') value += char
      }
    }
    stdin.on('data', onData)
    process.stderr.write(label)
  })
}

/** 普通行输入，支持默认值 */
export async function promptLine(label: string, options: { default?: string } = {}): Promise<string> {
  if (!process.stdin.isTTY) {
    const line = await readLineFromStdin()
    return line || options.default || ''
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  try {
    const suffix = options.default ? ` [${options.default}]` : ''
    const answer = (await rl.question(`${label}${suffix}: `)).trim()
    return answer || options.default || ''
  } finally {
    rl.close()
  }
}

export async function confirm(label: string, defaultValue = false): Promise<boolean> {
  const answer = (await promptLine(`${label} ${defaultValue ? '[Y/n]' : '[y/N]'}`)).trim().toLowerCase()
  if (!answer) return defaultValue
  return answer === 'y' || answer === 'yes' || answer === '是' || answer === '确定'
}

export async function select<T extends string>(
  label: string,
  choices: { value: T; label: string }[],
  defaultIndex = 0,
): Promise<T> {
  process.stderr.write(`${label}\n`)
  choices.forEach((choice, index) => {
    process.stderr.write(`  ${index + 1}) ${choice.label}${index === defaultIndex ? t('cli.prompt.defaultSuffix') : ''}\n`)
  })
  const answer = (await promptLine(t('cli.prompt.choose'), { default: String(defaultIndex + 1) })).trim()
  const index = Number(answer) - 1
  const choice = choices[index]
  if (!choice) throw new Error(t('cli.prompt.invalidChoice', { answer }))
  return choice.value
}
