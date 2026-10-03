import type * as FileSystem from 'node:fs'
import { spawn } from 'node:child_process'
import {
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import nacl from 'tweetnacl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadOrCreateMockServerKeyPair } from '../scripts/mock-server-key-pair'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof FileSystem>()
  return { ...actual, openSync: vi.fn(actual.openSync) }
})

const temporaryDirectories: string[] = []

type ConcurrentCreator = {
  ready: Promise<void>
  calling: Promise<void>
  start: () => void
  stop: () => void
  closed: Promise<void>
  result: Promise<string>
}

function keyFilePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'orca-mock-key-'))
  temporaryDirectories.push(directory)
  return join(directory, 'server-key')
}

function runConcurrentCreator(keyFile: string): ConcurrentCreator {
  const moduleUrl = pathToFileURL(
    join(import.meta.dirname, '../scripts/mock-server-key-pair.ts')
  ).href
  const script = `
    const { loadOrCreateMockServerKeyPair } = await import(process.argv[1])
    process.stdout.write('READY\\n')
    await new Promise((resolve) => process.stdin.once('data', resolve))
    process.stdout.write('CALLING\\n')
    const keyPair = loadOrCreateMockServerKeyPair(process.argv[2], { warn() {} })
    process.stdout.write('KEY:' + Buffer.from(keyPair.secretKey).toString('base64') + '\\n')
  `
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', script, moduleUrl, keyFile],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  )
  let stdout = ''
  let stderr = ''
  let resolveReady!: () => void
  let rejectReady!: (error: Error) => void
  let resolveCalling!: () => void
  let rejectCalling!: (error: Error) => void
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  const calling = new Promise<void>((resolve, reject) => {
    resolveCalling = resolve
    rejectCalling = reject
  })
  let resolveClosed!: () => void
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve
  })
  const timeout = setTimeout(() => child.kill(), 5_000)
  timeout.unref()
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString()
    if (stdout.includes('READY\n')) {
      resolveReady()
    }
    if (stdout.includes('CALLING\n')) {
      resolveCalling()
    }
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })
  const result = new Promise<string>((resolve, reject) => {
    child.on('error', (error) => {
      rejectReady(error)
      rejectCalling(error)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      resolveClosed()
      const error = new Error(stderr || `Concurrent key creator exited ${code}`)
      if (!stdout.includes('READY\n')) {
        rejectReady(error)
      }
      if (!stdout.includes('CALLING\n')) {
        rejectCalling(error)
      }
      const key = stdout.match(/KEY:([A-Za-z0-9+/=]+)\n/)?.[1]
      if (code === 0 && key) {
        resolve(key)
      } else {
        reject(error)
      }
    })
  })
  void result.catch(() => {})
  return {
    ready,
    calling,
    start: () => {
      if (!child.stdin.destroyed && !child.stdin.writableEnded) {
        child.stdin.end('go\n')
      }
    },
    stop: () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill()
      }
    },
    closed,
    result
  }
}

async function cleanupConcurrentCreators(
  creators: ConcurrentCreator[],
  lockFile: string,
  removeLock: boolean
): Promise<void> {
  let lockRemovalError: unknown
  if (removeLock) {
    try {
      rmSync(lockFile, { force: true })
    } catch (error) {
      lockRemovalError = error
    }
  }
  creators.forEach((creator) => {
    creator.start()
    creator.stop()
  })
  await Promise.allSettled(creators.flatMap((creator) => [creator.result, creator.closed]))
  if (lockRemovalError) {
    throw lockRemovalError
  }
}

afterEach(() => {
  vi.mocked(openSync).mockReset()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('mock server key persistence', () => {
  it('persists one private key and reuses it after restart', () => {
    const keyFile = keyFilePath()
    const first = loadOrCreateMockServerKeyPair(keyFile, { warn: vi.fn() })
    const second = loadOrCreateMockServerKeyPair(keyFile)

    expect(second.secretKey).toEqual(first.secretKey)
    expect(readFileSync(keyFile, 'utf-8')).toBe(Buffer.from(first.secretKey).toString('base64'))
    expect(readdirSync(dirname(keyFile))).toEqual(['server-key'])
    if (process.platform !== 'win32') {
      expect(statSync(keyFile).mode & 0o777).toBe(0o600)
    }
  })

  it('re-keys canonical-length content with malformed base64', () => {
    const keyFile = keyFilePath()
    const encoded = Buffer.from(nacl.box.keyPair().secretKey).toString('base64')
    const malformed = `${encoded.slice(0, 4)}!${encoded.slice(4)}`
    expect(Buffer.from(malformed, 'base64')).toHaveLength(nacl.box.secretKeyLength)
    writeFileSync(keyFile, malformed)
    const logger = { warn: vi.fn() }

    const loaded = loadOrCreateMockServerKeyPair(keyFile, logger)

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('invalid base64'))
    expect(readFileSync(keyFile, 'utf-8')).toBe(Buffer.from(loaded.secretKey).toString('base64'))
  })

  it.skipIf(process.platform !== 'win32').each(['EPERM', 'EACCES', 'EBUSY'])(
    'retries transient Windows lock contention %s without replacing the winner',
    (code) => {
      const keyFile = keyFilePath()
      const winner = nacl.box.keyPair()
      vi.mocked(openSync).mockImplementationOnce(() => {
        // Another creator publishes a complete key while this open races its lock release.
        writeFileSync(keyFile, Buffer.from(winner.secretKey).toString('base64'))
        throw Object.assign(new Error('lock sharing conflict'), { code })
      })
      const loaded = loadOrCreateMockServerKeyPair(keyFile, { warn: vi.fn() })
      expect(loaded.secretKey).toEqual(winner.secretKey)
      expect(readFileSync(keyFile, 'utf8')).toBe(Buffer.from(winner.secretKey).toString('base64'))
      expect(readdirSync(dirname(keyFile))).toEqual(['server-key'])
    }
  )

  it.skipIf(process.platform !== 'win32').each(['EPERM', 'EACCES', 'EBUSY'])(
    'acquires the lock after transient Windows denial %s ends',
    (code) => {
      const keyFile = keyFilePath()
      vi.mocked(openSync).mockImplementationOnce(() => {
        throw Object.assign(new Error('lock sharing conflict'), { code })
      })
      const loaded = loadOrCreateMockServerKeyPair(keyFile, { warn: vi.fn() })
      expect(readFileSync(keyFile, 'utf8')).toBe(Buffer.from(loaded.secretKey).toString('base64'))
      expect(readdirSync(dirname(keyFile))).toEqual(['server-key'])
    }
  )

  it.skipIf(process.platform !== 'win32').each(['EPERM', 'EACCES', 'EBUSY'])(
    'fails bounded persistent Windows lock denial %s without breaking the lock or key',
    (code) => {
      const keyFile = keyFilePath()
      writeFileSync(keyFile, 'invalid-existing-key')
      writeFileSync(`${keyFile}.lock`, 'other-owner')
      vi.mocked(openSync).mockImplementation(() => {
        throw Object.assign(new Error('lock denied'), { code })
      })
      expect(() => loadOrCreateMockServerKeyPair(keyFile)).toThrow('remained busy')
      expect(vi.mocked(openSync).mock.calls.length).toBeLessThanOrEqual(51)
      expect(readFileSync(keyFile, 'utf8')).toBe('invalid-existing-key')
      expect(readFileSync(`${keyFile}.lock`, 'utf8')).toBe('other-owner')
      expect(readdirSync(dirname(keyFile)).sort()).toEqual(['server-key', 'server-key.lock'])
    }
  )

  it.each(['linux', 'darwin'] as const)(
    'does not reinterpret permission errors on %s',
    (platform) => {
      const platformProbe = vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
      try {
        const keyFile = keyFilePath()
        vi.mocked(openSync)
          .mockClear()
          .mockImplementation(() => {
            throw Object.assign(new Error('permission denied'), { code: 'EPERM' })
          })
        expect(() => loadOrCreateMockServerKeyPair(keyFile)).toThrow('permission denied')
        expect(openSync).toHaveBeenCalledTimes(1)
        expect(readdirSync(dirname(keyFile))).toEqual([])
      } finally {
        platformProbe.mockRestore()
      }
    }
  )

  it('makes concurrent creators converge on the persisted winner', async () => {
    const keyFile = keyFilePath()
    const lockFile = `${keyFile}.lock`
    writeFileSync(lockFile, '', { flag: 'wx', mode: 0o600 })
    const firstCreator = runConcurrentCreator(keyFile)
    const secondCreator = runConcurrentCreator(keyFile)
    const creators = [firstCreator, secondCreator]
    let parentOwnsLock = true
    try {
      await Promise.all(creators.map((creator) => creator.ready))
      creators.forEach((creator) => creator.start())
      await Promise.all(creators.map((creator) => creator.calling))
      await new Promise((resolve) => setTimeout(resolve, 50))
      rmSync(lockFile)
      parentOwnsLock = false
      const [first, second] = await Promise.all(creators.map((creator) => creator.result))

      expect(second).toBe(first)
      expect(readFileSync(keyFile, 'utf-8')).toBe(first)
      expect(readdirSync(dirname(keyFile))).toEqual(['server-key'])
    } finally {
      await cleanupConcurrentCreators(creators, lockFile, parentOwnsLock)
    }
  })

  it('does not overwrite an invalid key owned by another creator', () => {
    const keyFile = keyFilePath()
    writeFileSync(keyFile, 'invalid')
    writeFileSync(`${keyFile}.lock`, '', { flag: 'wx', mode: 0o600 })

    expect(() => loadOrCreateMockServerKeyPair(keyFile)).toThrow('remained busy')
    expect(readFileSync(keyFile, 'utf-8')).toBe('invalid')
  })
})
