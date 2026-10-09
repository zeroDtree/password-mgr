import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  AAD_DATA, AAD_DEK, createKdfParams, deriveKey, generatePassword, randomKey, randomToken, seal, unseal,
} from '../src/crypto.ts'

describe('KDF (scrypt)', () => {
  it('相同密码与盐派生出相同密钥，不同盐不同密钥', () => {
    const params = createKdfParams()
    const a = deriveKey('correct horse', params)
    const b = deriveKey('correct horse', params)
    assert.deepEqual(a, b)
    assert.equal(a.length, 32)

    const other = deriveKey('correct horse', createKdfParams())
    assert.notDeepEqual(a, other)
  })

  it('不同密码派生不同密钥', () => {
    const params = createKdfParams()
    assert.notDeepEqual(deriveKey('a', params), deriveKey('b', params))
  })
})

describe('AES-256-GCM 封装', () => {
  it('加解密往返', () => {
    const key = randomKey()
    const sealed = seal('绝密内容 secret 🔐', key, AAD_DATA)
    assert.equal(sealed.algo, 'aes-256-gcm')
    assert.equal(unseal(sealed, key, AAD_DATA).toString('utf8'), '绝密内容 secret 🔐')
  })

  it('密钥错误时解密失败', () => {
    const sealed = seal('data', randomKey(), AAD_DATA)
    assert.throws(() => unseal(sealed, randomKey(), AAD_DATA))
  })

  it('密文被篡改时解密失败', () => {
    const key = randomKey()
    const sealed = seal('data', key, AAD_DATA)
    const bytes = Buffer.from(sealed.data, 'base64')
    bytes[0] = bytes[0]! ^ 0x01
    assert.throws(() => unseal({ ...sealed, data: bytes.toString('base64') }, key, AAD_DATA))
  })

  it('AAD 不匹配时解密失败（防止密文互换）', () => {
    const key = randomKey()
    const sealed = seal('dek', key, AAD_DEK)
    assert.throws(() => unseal(sealed, key, AAD_DATA))
  })

  it('相同明文两次加密结果不同（随机 IV）', () => {
    const key = randomKey()
    assert.notEqual(seal('same', key, AAD_DATA).data, seal('same', key, AAD_DATA).data)
  })
})

describe('密码生成器', () => {
  it('长度正确且每类字符至少出现一次', () => {
    for (let i = 0; i < 50; i++) {
      const password = generatePassword({ length: 16 })
      assert.equal(password.length, 16)
      assert.match(password, /[a-z]/)
      assert.match(password, /[A-Z]/)
      assert.match(password, /[0-9]/)
      assert.match(password, /[!@#$%^&*()\-_=+\[\]{}:,.?]/)
    }
  })

  it('可关闭字符集', () => {
    const password = generatePassword({ length: 32, symbols: false, uppercase: false })
    assert.match(password, /^[a-z0-9]+$/)
  })

  it('排除易混淆字符', () => {
    for (let i = 0; i < 50; i++) {
      assert.doesNotMatch(generatePassword({ length: 40, excludeAmbiguous: true }), /[Il1O0o|`'"]/)
    }
  })

  it('拒绝非法长度', () => {
    assert.throws(() => generatePassword({ length: 3 }))
    assert.throws(() => generatePassword({ length: 1000 }))
  })

  it('随机性：多次生成不重复', () => {
    const set = new Set(Array.from({ length: 200 }, () => generatePassword({ length: 20 })))
    assert.equal(set.size, 200)
  })
})

describe('randomToken', () => {
  it('生成 URL 安全的随机令牌', () => {
    const token = randomToken()
    assert.match(token, /^[A-Za-z0-9_-]+$/)
    assert.ok(token.length >= 30)
    assert.notEqual(token, randomToken())
  })
})
