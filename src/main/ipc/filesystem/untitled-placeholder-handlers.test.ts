import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resolveUntitledPlaceholderRetentionRoot,
  UntitledPlaceholderRecoveryLocationUnavailableError
} from '../../../shared/untitled-placeholder-recovery-directory'
import { registerUntitledPlaceholderHandlers } from './untitled-placeholder-handlers'
import type { FilesystemHandlerContext } from './filesystem-handler-context'
import type { SshMutationExpectation } from '../../../shared/ssh-types'

const ports = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  authorize: vi.fn<(path: string) => Promise<string>>(),
  userData: null as string | null,
  environmentError: null as Error | null
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      ports.handlers.set(channel, handler)
  }
}))
vi.mock('../local-file-access-resolution', () => ({
  resolveDesktopAuthorizedPath: ports.authorize
}))
vi.mock('../../../shared/app-environment', () => ({
  hasAppEnvironment: () => ports.userData !== null || ports.environmentError !== null,
  getAppEnvironment: () => ({
    getPath: () => {
      if (ports.environmentError) {
        throw ports.environmentError
      }
      return ports.userData
    }
  })
}))

let directory: string
let workspace: string
let filePath: string
let otherPath: string
let lifetime: EventEmitter
let destroyed: boolean
let event: { sender: { id: number; once: EventEmitter['once']; isDestroyed: () => boolean } }

function destroy(): void {
  if (!destroyed) {
    destroyed = true
    lifetime.emit('destroyed')
  }
}

async function invoke(
  channel = 'fs:createUntitledPlaceholder',
  args: SshMutationExpectation & { leaseToken?: string } = {}
): Promise<unknown> {
  const handler = ports.handlers.get(channel)
  if (!handler) {
    throw new Error('Actual handler was not registered')
  }
  return handler(event, { filePath, expectedExecutionHostId: 'local', ...args })
}

beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'untitled-desktop-fallback-')))
  workspace = join(directory, 'workspace')
  await mkdir(workspace)
  filePath = join(workspace, 'untitled.md')
  otherPath = join(workspace, 'other.md')
  ports.handlers.clear()
  ports.authorize.mockReset().mockImplementation(async (path) => path)
  ports.userData = null
  ports.environmentError = null
  lifetime = new EventEmitter()
  destroyed = false
  event = { sender: { id: 417, once: lifetime.once.bind(lifetime), isDestroyed: () => destroyed } }
  registerUntitledPlaceholderHandlers({ store: {} } as unknown as FilesystemHandlerContext)
  await expect(resolveUntitledPlaceholderRetentionRoot(filePath)).rejects.toBeInstanceOf(
    UntitledPlaceholderRecoveryLocationUnavailableError
  )
})

afterEach(async () => {
  destroy()
  ports.userData = null
  ports.environmentError = null
  await rm(directory, { recursive: true, force: true })
  expect(existsSync(directory)).toBe(false)
})

describe('desktop ordinary untitled creation after proved unavailable retention location', () => {
  it('creates a real empty file exclusively and returns no fabricated lease', async () => {
    expect(await invoke()).toBeNull()
    expect(await readFile(filePath, 'utf8')).toBe('')
    expect(ports.authorize.mock.calls.map(([path]) => path)).toEqual([filePath, filePath, filePath])
    expect(
      await invoke('fs:discardUntitledPlaceholder', { leaseToken: 'no-issued-lease' })
    ).toEqual({
      status: 'unavailable',
      reason: 'lease-unavailable'
    })
    expect(await readFile(filePath, 'utf8')).toBe('')
  })

  it('rejects a sender lost during initial authorization before creating any file', async () => {
    ports.authorize.mockImplementation(async (path) => {
      destroy()
      return path
    })
    await expect(invoke()).rejects.toThrow('owner is unavailable')
    expect(ports.authorize).toHaveBeenCalledTimes(1)
    expect(existsSync(filePath)).toBe(false)
  })

  it.each(['owner', 'path', 'permission'] as const)(
    'rejects %s changes during fallback reauthorization without creating either target',
    async (change) => {
      let calls = 0
      ports.authorize.mockImplementation(async (path) => {
        if (++calls > 1) {
          if (change === 'owner') {
            destroy()
          }
          if (change === 'path') {
            return otherPath
          }
          if (change === 'permission') {
            throw new Error('Fixture authorization revoked')
          }
        }
        return path
      })
      await expect(invoke()).rejects.toThrow()
      expect(existsSync(filePath)).toBe(false)
      expect(existsSync(otherPath)).toBe(false)
    }
  )

  it.each(['owner', 'path', 'permission'] as const)(
    'rejects a post-write %s change and retains the actual created file',
    async (change) => {
      ports.authorize.mockImplementation(async (path) => {
        if (existsSync(filePath)) {
          if (change === 'owner') {
            destroy()
          }
          if (change === 'path') {
            return otherPath
          }
          if (change === 'permission') {
            throw new Error('Fixture authorization revoked after wx')
          }
        }
        return path
      })
      await expect(invoke()).rejects.toThrow()
      expect(await readFile(filePath, 'utf8')).toBe('')
      expect(existsSync(otherPath)).toBe(false)
    }
  )

  it('preserves actual collision contents when ordinary exclusive creation fails', async () => {
    await writeFile(filePath, 'existing user bytes')
    await expect(invoke()).rejects.toThrow('already exists')
    expect(await readFile(filePath, 'utf8')).toBe('existing user bytes')
    expect(ports.authorize).toHaveBeenCalledTimes(2)
  })

  it('does not turn an actual retained-source EEXIST into an ordinary create attempt', async () => {
    ports.userData = join(directory, 'app-data')
    await mkdir(ports.userData, { mode: 0o700 })
    await writeFile(filePath, 'existing retained-source bytes')
    await expect(invoke()).rejects.toMatchObject({
      code: 'EEXIST',
      creationStage: 'open-source',
      creationOutcome: 'unknown'
    })
    expect(ports.authorize).toHaveBeenCalledTimes(1)
    expect(await readFile(filePath, 'utf8')).toBe('existing retained-source bytes')
  })

  it('keeps an operational AppEnvironment refusal distinct and performs no fallback', async () => {
    const cause = Object.assign(new Error('Fixture AppEnvironment access refused'), {
      code: 'EACCES'
    })
    ports.environmentError = cause
    await expect(invoke()).rejects.toMatchObject({
      cause,
      code: 'EACCES',
      creationStage: 'resolve-location',
      creationOutcome: 'not-attempted'
    })
    expect(ports.authorize).toHaveBeenCalledTimes(1)
    expect(existsSync(filePath)).toBe(false)
  })

  it('never converts an explicit different execution host into local ordinary creation', async () => {
    await expect(
      invoke('fs:createUntitledPlaceholder', { expectedExecutionHostId: 'ssh:other' })
    ).rejects.toThrow('Workspace host changed')
    expect(ports.authorize).not.toHaveBeenCalled()
    expect(existsSync(filePath)).toBe(false)
  })
})
