import { createServer } from 'node:https'
import { createHash, X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { once } from 'node:events'
import { build } from 'esbuild'
import { chromium, type Browser, type Page } from '@playwright/test'
import { expect, vi } from 'vitest'

export async function startAccountRelayBrowser(
  directory: string,
  createIntent: (body: object) => Promise<unknown>
) {
  const built = await build({
    stdin: {
      resolveDir: resolve('.'),
      contents: `
    import { HiveAccountRelayChannel } from './src/shared/hive-account-relay-channel'
    import { acquireHiveAccountRelayMaterial, relayBase64Url } from './src/shared/hive-account-relay-material'
    async function run() {
      const material = await acquireHiveAccountRelayMaterial({ clientKind: 'WEB', expectedResourceVersion: 7,
        createIntent: async (request) => {
          const response = await fetch('/intent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) })
          if (!response.ok) throw new Error('Intent failed')
          return response.json()
        } })
      const canary = relayBase64Url(material.inner.ticketSecret)
      const channel = new HiveAccountRelayChannel({ material, createSocket: (url) => {
        const socket = new WebSocket(url)
        const send = socket.send.bind(socket)
        socket.send = (frame) => {
          if (typeof frame === 'string' && frame.includes(canary)) throw new Error('Secret escaped E2EE')
          send(frame)
        }
        return socket
      }, onClosed: () => { document.querySelector('#state').textContent = 'closed' } })
      addEventListener('pagehide', () => channel.close(), { once: true })
      await channel.connect()
      const response = await channel.request({ id: 'browser-read', method: 'fixture.read' })
      if (!response.ok || !response.result.principal.startsWith('account-runtime:')) throw new Error('Wrong principal')
      document.querySelector('#rpc').textContent = 'account RPC ready'
      channel.subscribe({ id: 'browser-stream', method: 'fixture.stream' }, {
        onResponse: (response) => { if (response.ok && response.result.value === 'stream-ready') document.querySelector('#stream').textContent = 'stream ready' },
        onBinary: (bytes) => { if (Array.from(bytes).join(',') === '1,2,3') document.querySelector('#binary').textContent = 'binary ready' }
      })
      document.querySelector('#state').textContent = 'connected'
    }
    run().catch((error) => { document.querySelector('#state').textContent = 'failed: ' + error.message })
  `
    },
    bundle: true,
    platform: 'browser',
    format: 'iife',
    write: false
  })
  const certificate = readFileSync(join(directory, 'cert.pem'))
  const keys: string[] = []
  const server = createServer(
    { cert: certificate, key: readFileSync(join(directory, 'key.pem')) },
    async (request, response) => {
      response.setHeader('cache-control', 'no-store')
      try {
        if (request.method === 'POST' && request.url === '/intent') {
          let body = ''
          for await (const chunk of request) {
            body += chunk.toString()
            if (body.length > 8192) {
              throw new Error('Request limit')
            }
          }
          const value = JSON.parse(body)
          keys.push(value.clientPublicKeyB64)
          const intent = await createIntent({
            secretHash: value.ticketSecretSha256,
            clientPublicKey: value.clientPublicKeyB64,
            clientKind: 'WEB'
          })
          response.setHeader('content-type', 'application/json')
          response.end(JSON.stringify(intent))
        } else if (request.url === '/client.js') {
          response.setHeader('content-type', 'application/javascript')
          response.end(built.outputFiles[0]!.contents)
        } else {
          response.setHeader('content-type', 'text/html')
          response.end(
            '<!doctype html><title>Relay integration</title><p id="state">starting</p><p id="rpc"></p><p id="stream"></p><p id="binary"></p><script src="/client.js"></script>'
          )
        }
      } catch {
        response.writeHead(500)
        response.end('Fixture request failed')
      }
    }
  )
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `https://localhost:${(server.address() as { port: number }).port}`
  let browser: Browser | null = null,
    page: Page | null = null
  const diagnostics: string[] = []
  const ready = async () => {
    await vi.waitFor(
      async () => {
        expect(await page!.locator('#state').textContent(), diagnostics.join('\n')).toBe(
          'connected'
        )
        expect(await page!.locator('#rpc').textContent()).toBe('account RPC ready')
        expect(await page!.locator('#stream').textContent()).toBe('stream ready')
        expect(await page!.locator('#binary').textContent()).toBe('binary ready')
      },
      { timeout: 15000 }
    )
  }
  return {
    origin,
    async run() {
      const spki = new X509Certificate(certificate).publicKey.export({
        type: 'spki',
        format: 'der'
      })
      const pin = createHash('sha256').update(spki).digest('base64')
      browser = await chromium.launch({
        channel: 'chrome',
        headless: true,
        args: [`--ignore-certificate-errors-spki-list=${pin}`]
      })
      page = await browser.newPage()
      const network = await page.context().newCDPSession(page)
      const offers: string[] = [],
        acceptedExtensions: unknown[] = []
      await network.send('Network.enable')
      network.on('Network.webSocketWillSendHandshakeRequest', ({ request }) => {
        offers.push(String(request.headers['Sec-WebSocket-Extensions'] ?? ''))
      })
      network.on('Network.webSocketHandshakeResponseReceived', ({ response }) => {
        acceptedExtensions.push(response.headers['Sec-WebSocket-Extensions'])
      })
      page.on('console', (message) => {
        if (message.type() === 'error' && diagnostics.length < 8) {
          diagnostics.push(message.text().slice(0, 512))
        }
      })
      await page.goto(origin)
      await ready()
      await page.reload()
      await ready()
      expect(keys).toHaveLength(2)
      expect(new Set(keys).size).toBe(2)
      expect(offers.some((offer) => offer.includes('permessage-deflate'))).toBe(true)
      expect(acceptedExtensions).toEqual([undefined, undefined])
      expect(
        await page.evaluate(async () => ({
          local: localStorage.length,
          session: sessionStorage.length,
          databases: (await indexedDB.databases()).length
        }))
      ).toEqual({ local: 0, session: 0, databases: 0 })
      expect(await page.context().cookies()).toEqual([])
    },
    async assertRevoked() {
      await vi.waitFor(async () =>
        expect(await page!.locator('#state').textContent()).toBe('closed')
      )
    },
    async stop() {
      await browser?.close()
      await new Promise<void>((done) => server.close(() => done()))
    }
  }
}
