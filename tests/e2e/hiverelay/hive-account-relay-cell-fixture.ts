import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { once } from 'node:events'
import { runProcess, spawnProcess } from '../../../src/shared/child-process/run-process'
import { expect, vi } from 'vitest'

export async function startAccountRelayCell(
  directory: string,
  cellId: string,
  relaySigningPublicKey: string,
  certificateReady?: () => Promise<string>
) {
  const openssl =
    process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl'
  const certificate = await runProcess({
    program: openssl,
    args: [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(directory, 'key.pem'),
      '-out',
      join(directory, 'cert.pem'),
      '-subj',
      '/CN=localhost',
      '-days',
      '1',
      '-addext',
      'subjectAltName=DNS:localhost',
      '-addext',
      'basicConstraints=critical,CA:TRUE'
    ]
  })
  expect(certificate.code).toBe(0)
  const browserOrigins = certificateReady ? [await certificateReady()] : []
  writeFileSync(
    join(directory, 'input.json'),
    JSON.stringify({ cellId, relaySigningPublicKey, browserOrigins })
  )
  const child = spawnProcess({
    program: 'mise',
    args: [
      'exec',
      'elixir@1.20.2-otp-29',
      'erlang@29.0.3',
      '--',
      'mix',
      'run',
      '--no-start',
      resolve('tests/e2e/hiverelay/hive-account-relay-cell-fixture.exs')
    ],
    cwd: resolve('../hive-relay-cell'),
    env: { ...process.env, HIVE_P4_CELL_FIXTURE: directory }
  })
  let diagnostic = ''
  child.stdout.on('data', (bytes) => {
    diagnostic = (diagnostic + bytes.toString()).slice(-32000)
  })
  child.stderr.on('data', (bytes) => {
    diagnostic = (diagnostic + bytes.toString()).slice(-32000)
  })
  const stopped = once(child, 'close')
  const stop = async () => {
    writeFileSync(join(directory, 'stop'), '')
    await stopped
  }
  try {
    await vi.waitFor(
      () => {
        if (child.exitCode !== null) {
          throw new Error(`Cell exited: ${diagnostic}`)
        }
        expect(existsSync(join(directory, 'ready.json')), diagnostic).toBe(true)
      },
      { timeout: 30000 }
    )
    return {
      ...JSON.parse(readFileSync(join(directory, 'ready.json'), 'utf8')),
      ca: readFileSync(join(directory, 'cert.pem')),
      stop,
      diagnostic: () => diagnostic
    }
  } catch (error) {
    await stop()
    throw error
  }
}
