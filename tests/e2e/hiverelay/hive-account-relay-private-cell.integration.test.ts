import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { request } from 'node:https'
import { expect, it } from 'vitest'
import { startAccountRelayCell } from './hive-account-relay-cell-fixture'

it('requires a trusted client certificate on the optional private Cell listener', async () => {
  const root = resolve('logs/upstream-sync/private-cell')
  mkdirSync(root, { recursive: true })
  const directory = mkdtempSync(join(root, 'private-cell-'))
  let cell: Awaited<ReturnType<typeof startAccountRelayCell>> | undefined
  try {
    const signing = generateKeyPairSync('ed25519')
    const publicKey = signing.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32)
    cell = await startAccountRelayCell(
      directory,
      randomUUID(),
      publicKey.toString('base64'),
      undefined,
      undefined,
      true
    )
    const pki = cell.privatePki!
    const fetchMetrics = (authenticated: boolean) =>
      new Promise<number>((done, fail) => {
        const req = request(
          new URL('/metrics', cell!.privateOrigin!),
          {
            ca: readFileSync(pki.caPemPath),
            ...(authenticated
              ? {
                  cert: readFileSync(pki.clientCertPath),
                  key: readFileSync(pki.clientKeyPath)
                }
              : {}),
            timeout: 5000
          },
          (response) => {
            response.resume()
            response.on('end', () => done(response.statusCode!))
          }
        )
        req.on('error', fail)
        req.on('timeout', () => req.destroy(new Error('Private fixture request timed out')))
        req.end()
      })
    expect(await fetchMetrics(true)).toBe(200)
    await expect(fetchMetrics(false)).rejects.toMatchObject({
      code: expect.stringMatching(/^ERR_SSL_.*(?:CERTIFICATE_REQUIRED|HANDSHAKE_FAILURE)$/)
    })
  } finally {
    await cell?.stop()
    expect(dirname(resolve(directory))).toBe(root)
    expect(basename(directory)).toMatch(/^private-cell-/)
    rmSync(directory, { recursive: true, force: true })
  }
}, 90_000)
