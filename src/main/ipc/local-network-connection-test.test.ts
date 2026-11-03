import { createServer } from 'node:net'
import { describe, expect, it } from 'vitest'
import { testLocalNetworkConnection } from './local-network-connection-test'

describe('testLocalNetworkConnection', () => {
  it('rejects a hostname that resolves to loopback in the real child probe', async () => {
    const server = createServer()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Expected a TCP listener address')
    }

    try {
      const result = await testLocalNetworkConnection(
        { host: '2130706433', port: address.port },
        { platform: 'darwin' }
      )
      expect(result).toMatchObject({ ok: false })
      if (result.ok) {
        throw new Error('Numeric loopback hostname unexpectedly passed the LAN probe')
      }
      expect(
        process.platform === 'win32'
          ? ['invalid-target', 'unresolved', 'timeout']
          : ['invalid-target']
      ).toContain(result.failure)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
