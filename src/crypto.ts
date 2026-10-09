/**
 * 密码学原语：scrypt 派生主密钥（KEK）+ AES-256-GCM 封装数据密钥（DEK）。
 *
 * 设计：
 *   主密码 --scrypt(salt, N, r, p)--> KEK --AES-GCM 解封--> DEK --AES-GCM 解密--> 明文数据
 *
 * 数据用随机生成的 DEK 加密、KEK 只负责封装 DEK，因此修改主密码
 * 只需重新封装 DEK，无需重新加密整个保险库。
 */
import { createCipheriv, createDecipheriv, randomBytes, randomInt, scryptSync } from 'node:crypto'
import { t } from './i18n/index.ts'

export interface KdfParams {
  algo: 'scrypt'
  /** CPU/内存代价，必须是 2 的幂 */
  N: number
  r: number
  p: number
  /** base64 */
  salt: string
}

/** AES-256-GCM 密文封套 */
export interface Sealed {
  algo: 'aes-256-gcm'
  /** base64，12 字节 */
  iv: string
  /** base64，16 字节认证标签 */
  tag: string
  /** base64 密文 */
  data: string
}

/** 默认 scrypt 参数：64 MiB 内存、约 0.2~0.5s */
const DEFAULT_KDF: Pick<KdfParams, 'algo' | 'N' | 'r' | 'p'> = {
  algo: 'scrypt',
  N: 1 << 16,
  r: 8,
  p: 1,
}

const KEY_LENGTH = 32
const IV_LENGTH = 12

/** 附加认证数据：把密文绑定到它在文件中的角色，防止密文互换 */
export const AAD_DEK = 'pmvault:v1:dek'
export const AAD_DATA = 'pmvault:v1:data'

export function createKdfParams(): KdfParams {
  return { ...DEFAULT_KDF, salt: randomBytes(16).toString('base64') }
}

export function deriveKey(password: string, params: KdfParams): Buffer {
  if (params.algo !== 'scrypt') throw new Error(t('common.errors.cryptoAlgo', { algo: params.algo }))
  const memory = 128 * params.N * params.r
  return scryptSync(password, Buffer.from(params.salt, 'base64'), KEY_LENGTH, {
    N: params.N,
    r: params.r,
    p: params.p,
    // node 默认 maxmem 只有 32MiB，必须显式放宽
    maxmem: memory * 2,
  })
}

export function seal(plaintext: Buffer | string, key: Buffer, aad: string): Sealed {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return {
    algo: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  }
}

/** 解密失败（密码错误或文件被篡改）会抛出异常 */
export function unseal(sealed: Sealed, key: Buffer, aad: string): Buffer {
  if (sealed.algo !== 'aes-256-gcm') throw new Error(t('common.errors.cipherAlgo', { algo: sealed.algo }))
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'))
  decipher.setAAD(Buffer.from(aad, 'utf8'))
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()])
}

export function randomKey(): Buffer {
  return randomBytes(KEY_LENGTH)
}

/** base64url 随机令牌，用于 Web UI 的本地会话鉴权 */
export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url')
}

interface GenerateOptions {
  length?: number
  lowercase?: boolean
  uppercase?: boolean
  digits?: boolean
  symbols?: boolean
  /** 排除易混淆字符 0O1lI 等 */
  excludeAmbiguous?: boolean
}

const CHARSETS = {
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{}:,.?',
} as const

const AMBIGUOUS = new Set("Il1O0o|`'\"")

export function generatePassword(options: GenerateOptions = {}): string {
  const length = options.length ?? 20
  if (!Number.isInteger(length) || length < 4 || length > 512) {
    throw new Error(t('common.errors.passwordLength'))
  }

  const enabled = (['lowercase', 'uppercase', 'digits', 'symbols'] as const)
    .filter(name => options[name] ?? true)

  const sets = enabled.map(name => {
    let charset: string = CHARSETS[name]
    if (options.excludeAmbiguous) {
      charset = [...charset].filter(ch => !AMBIGUOUS.has(ch)).join('')
    }
    return charset
  }).filter(set => set.length > 0)

  if (!sets.length) throw new Error(t('common.errors.charsetRequired'))

  const pool = sets.join('')
  const chars: string[] = []

  // 每类字符至少出现一次（长度不足时退化为纯随机）
  if (length >= sets.length) {
    for (const set of sets) chars.push(set[randomInt(set.length)]!)
  }
  while (chars.length < length) {
    chars.push(pool[randomInt(pool.length)]!)
  }

  // Fisher–Yates 洗牌，避免"每类第一个"固定在开头
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    const tmp = chars[i]!
    chars[i] = chars[j]!
    chars[j] = tmp
  }
  return chars.join('')
}
