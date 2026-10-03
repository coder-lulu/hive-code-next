import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { runProcess, spawnProcess } from '../../../src/shared/child-process/run-process'
import { forceTerminateProcessTree } from '../../../src/shared/child-process/process-tree-termination'
import { expect } from 'vitest'
import { createCellObservationReader } from './hive-account-relay-observation'
import { createCellPrivatePki } from './hive-account-relay-private-pki'

type CellReady = {
  cellId: string
  cellIncarnationId: string
  port: number
  processPid: string
  privateOrigin: string | null
  caPemPath: string | null
  clientPkcs12Path: string | null
}

export async function startAccountRelayCell(
  directory: string,
  cellId: string,
  relaySigningPublicKey: string,
  certificateReady?: () => Promise<string>,
  capacity?: { lifetimeMs: number; authenticatedSlots: number },
  privateOps = false
) {
  const cellSource = process.env.HIVE_RELAY_CELL_SOURCE
  if (cellSource !== undefined && !isAbsolute(cellSource)) {
    throw new Error('HIVE_RELAY_CELL_SOURCE must be an absolute path')
  }
  if (
    capacity &&
    (!Number.isSafeInteger(capacity.lifetimeMs) ||
      capacity.lifetimeMs < 90_000 ||
      capacity.lifetimeMs > 1_200_000 ||
      !Number.isSafeInteger(capacity.authenticatedSlots) ||
      capacity.authenticatedSlots < 32 ||
      capacity.authenticatedSlots > 384)
  ) {
    throw new Error('Invalid bounded Cell capacity fixture')
  }
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
  const privatePki = privateOps ? await createCellPrivatePki(directory, openssl) : undefined
  const browserOrigins = certificateReady ? [await certificateReady()] : []
  writeFileSync(
    join(directory, 'input.json'),
    JSON.stringify({ cellId, relaySigningPublicKey, browserOrigins, ...capacity, privatePki })
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
    cwd: cellSource ?? resolve('../hive-relay-cell'),
    detached: true,
    env: { ...process.env, HIVE_P4_CELL_FIXTURE: directory }
  })
  let diagnostic = ''
  child.stdout.on('data', (bytes) => {
    diagnostic = (diagnostic + bytes.toString()).slice(-32000)
  })
  child.stderr.on('data', (bytes) => {
    diagnostic = (diagnostic + bytes.toString()).slice(-32000)
  })
  let closed = false
  let childError: Error | undefined
  let exitError: Error | undefined
  const failed = Promise.withResolvers<Error>()
  const stopped = Promise.withResolvers<{ error?: Error }>()
  const exited = (code: number | null, signal: NodeJS.Signals | null) => {
    exitError ??= childError ?? new Error(`Cell exited (${signal ?? code}): ${diagnostic}`)
    failed.resolve(exitError)
  }
  child.on('error', (error) => {
    childError ??= error
    failed.resolve(childError)
  })
  child.once('exit', exited)
  child.once('close', (code, signal) => {
    closed = true
    exited(code, signal)
    stopped.resolve({ error: childError })
  })
  let stopping: Promise<void> | undefined
  const stop = () => {
    stopping ??= (async () => {
      let cleanupError: unknown
      let forceTimer: ReturnType<typeof setTimeout> | undefined
      let forced: Promise<void> | undefined
      const force = () => {
        forced ??= forceTerminateProcessTree(child).then(
          (terminated) => {
            if (!terminated) {
              cleanupError ??= new Error('Cell fixture tree termination unverified')
            }
          },
          (error) => {
            cleanupError ??= error
          }
        )
      }
      if (!closed) {
        try {
          if (!childError) {
            writeFileSync(join(directory, 'stop'), '')
          }
        } catch (error) {
          cleanupError = error
          force()
        }
        if (!closed) {
          forceTimer = setTimeout(force, 5_000)
        }
      }
      try {
        const outcome = await stopped.promise
        await forced
        if (cleanupError) {
          throw cleanupError
        }
        if (outcome.error) {
          throw outcome.error
        }
      } finally {
        clearTimeout(forceTimer)
      }
    })()
    return stopping
  }
  let readinessTimer: ReturnType<typeof setTimeout> | undefined
  let readinessDeadline: ReturnType<typeof setTimeout> | undefined
  try {
    await new Promise<void>((ready, reject) => {
      void failed.promise.then(reject)
      const check = () => {
        try {
          if (existsSync(join(directory, 'ready.json'))) {
            ready()
          } else {
            readinessTimer = setTimeout(check, 50)
          }
        } catch (error) {
          reject(error)
        }
      }
      readinessDeadline = setTimeout(() => {
        reject(new Error(`Cell readiness timed out in 30000ms: ${diagnostic}`))
      }, 30_000)
      check()
    })
    if (childError) {
      throw childError
    }
    if (exitError) {
      throw exitError
    }
    const observation = createCellObservationReader(join(directory, 'observation.json'))
    const ready: CellReady = JSON.parse(readFileSync(join(directory, 'ready.json'), 'utf8'))
    return {
      ...ready,
      ca: readFileSync(join(directory, 'cert.pem')),
      privatePki,
      readObservation: observation.read,
      observationReadGaps: () => ({ cellId, gaps: observation.gaps() }),
      stop,
      diagnostic: () => diagnostic
    }
  } catch (error) {
    clearTimeout(readinessTimer)
    clearTimeout(readinessDeadline)
    try {
      await stop()
    } catch {
      // Cleanup must not replace the original startup failure.
    }
    throw error
  } finally {
    clearTimeout(readinessTimer)
    clearTimeout(readinessDeadline)
  }
}
