/** 终端输出：ANSI 颜色、中日韩宽度对齐的表格、密码打码 */
const useColor = process.stdout.isTTY === true && !process.env.NO_COLOR

function wrap(code: string, close: string) {
  return (text: string | number) => useColor ? `\u001b[${code}m${text}\u001b[${close}m` : String(text)
}

export const color = {
  bold: wrap('1', '22'),
  dim: wrap('2', '22'),
  red: wrap('31', '39'),
  green: wrap('32', '39'),
  yellow: wrap('33', '39'),
  blue: wrap('34', '39'),
  magenta: wrap('35', '39'),
  cyan: wrap('36', '39'),
}

const ANSI_REGEXP = /\u001b\[[0-9;]*m/g

/** 终端显示宽度：CJK 全角字符算 2 列 */
export function displayWidth(text: string): number {
  let width = 0
  for (const char of text.replace(ANSI_REGEXP, '')) {
    const code = char.codePointAt(0)!
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff)
    width += wide ? 2 : 1
  }
  return width
}

export function pad(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - displayWidth(text)))
}

export function table(headers: string[], rows: string[][]): string {
  if (!rows.length) return ''
  const all = [headers, ...rows]
  const widths = headers.map((_, column) =>
    Math.max(...all.map(row => displayWidth(row[column] ?? ''))))

  const lines = [
    headers.map((header, index) => color.bold(pad(header, widths[index]!))).join('  '),
    widths.map(width => color.dim('─'.repeat(width))).join('──'),
  ]
  for (const row of rows) {
    lines.push(row.map((cell, index) => pad(cell ?? '', widths[index]!)).join('  '))
  }
  return lines.join('\n')
}

/** 密码打码显示 */
export function mask(secret: string | undefined): string {
  if (!secret) return color.dim('—')
  if (secret.length <= 4) return '•'.repeat(secret.length)
  return '•'.repeat(Math.min(12, secret.length))
}

export function truncate(text: string, max: number): string {
  return displayWidth(text) <= max ? text : [...text].slice(0, Math.max(0, max - 1)).join('') + '…'
}

export function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad2 = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}
