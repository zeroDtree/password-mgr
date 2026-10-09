/**
 * Web UI 访问控制：页面壳可无令牌打开，接口必须带令牌，来源精确到当前端口。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { Context } from 'cordis'
import Server from '@cordisjs/plugin-server'
import { setLocale } from '../src/i18n/index.ts'
import { Vault } from '../src/plugins/vault.ts'
import Web from '../src/plugins/web.ts'

setLocale('zh')

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

describe('Web UI 访问控制', () => {
  it('页面壳无需令牌，接口必须带令牌，并拒绝其他来源', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-web-'))
    const ctx = new Context()
    const token = 'test-token'
    const fibers = []
    try {
      fibers.push(await ctx.plugin(Vault, { file: path.join(dir, 'vault.json') }))
      fibers.push(await ctx.plugin(Server, { host: '127.0.0.1', port: await freePort() }))
      fibers.push(await ctx.plugin(Web, { token, autoLockMinutes: 0, open: false }))
      const base = `http://127.0.0.1:${ctx.server.port}`

      const page = await fetch(base + '/')
      assert.equal(page.status, 200)
      assert.match(await page.text(), /pm-token/)
      assert.match(page.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/)
      assert.equal(page.headers.get('referrer-policy'), 'no-referrer')

      assert.equal((await fetch(base + '/api/status')).status, 401)

      const authed = await fetch(base + '/api/status', { headers: { 'x-vault-token': token } })
      assert.equal(authed.status, 200)
      const status = await authed.json() as { unlocked: boolean }
      assert.equal(status.unlocked, false)

      const otherPort = await fetch(base + '/api/status', {
        headers: { 'x-vault-token': token, origin: 'http://127.0.0.1:1' },
      })
      assert.equal(otherPort.status, 403)

      const crossSite = await fetch(base + '/api/status', {
        headers: { 'x-vault-token': token, 'sec-fetch-site': 'cross-site' },
      })
      assert.equal(crossSite.status, 403)
    } finally {
      for (const fiber of fibers.reverse()) await fiber.dispose().catch(() => {})
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
