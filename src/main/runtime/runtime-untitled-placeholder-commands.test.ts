import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import {
  resolveUntitledPlaceholderRetentionRoot,
  UntitledPlaceholderRecoveryLocationUnavailableError
} from '../../shared/untitled-placeholder-recovery-directory'
import { RuntimeUntitledPlaceholderCommands } from './runtime-untitled-placeholder-commands'
import type { RuntimeFileExplorerPath } from './runtime-file-command-target'
import type { Store } from '../persistence'

const ports = vi.hoisted(() => ({
  authorize: vi.fn<(path: string) => Promise<string>>(),
  userData: null as string | null,
  environmentError: null as Error | null
}))
vi.mock('../ipc/filesystem-auth', () => ({ resolveAuthorizedPath: ports.authorize }))
vi.mock('../../shared/app-environment', () => ({
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

const CLIENT = 'authenticated-connection-a'
let directory: string
let workspace: string
let filePath: string
let otherPath: string
let targetPath: string
let service: RuntimeUntitledPlaceholderCommands
let onResolve: (() => void) | undefined
let onOrdinaryCreated: (() => void) | undefined
type OrdinaryCreate = ConstructorParameters<
  typeof RuntimeUntitledPlaceholderCommands
>[0]['createFileExplorerFile']
let ordinary: Mock<OrdinaryCreate>

function create(): Promise<string | null> {
  return service.createUntitledPlaceholder(
    'workspace-a',
    'untitled.md',
    CLIENT,
    undefined,
    undefined,
    'local'
  )
}

beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'untitled-runtime-fallback-')))
  workspace = join(directory, 'workspace')
  await mkdir(workspace)
  filePath = join(workspace, 'untitled.md')
  otherPath = join(workspace, 'other.md')
  targetPath = filePath
  ports.authorize.mockReset().mockImplementation(async (path) => path)
  ports.userData = null
  ports.environmentError = null
  onResolve = undefined
  onOrdinaryCreated = undefined
  ordinary = vi.fn<OrdinaryCreate>(async (_worktree, relativePath) => {
    await writeFile(join(workspace, relativePath), '', { encoding: 'utf8', flag: 'wx' })
    onOrdinaryCreated?.()
    return { ok: true as const }
  })
  service = new RuntimeUntitledPlaceholderCommands({
    getRuntimeId: () => 'actual-runtime-a',
    requireStore: () => ({}) as Store,
    resolveFileExplorerPath: async () => {
      onResolve?.()
      return {
        worktree: { id: 'worktree-a' } as RuntimeFileExplorerPath['worktree'],
        path: targetPath,
        executionHostId: 'local'
      }
    },
    createFileExplorerFile: ordinary
  })
  await expect(resolveUntitledPlaceholderRetentionRoot(filePath)).rejects.toBeInstanceOf(
    UntitledPlaceholderRecoveryLocationUnavailableError
  )
})

afterEach(async () => {
  service.releaseUntitledPlaceholdersForClient(CLIENT)
  ports.userData = null
  ports.environmentError = null
  await rm(directory, { recursive: true, force: true })
  expect(existsSync(directory)).toBe(false)
})

describe('runtime ordinary untitled creation after proved unavailable retention location', () => {
  it('uses the ordinary creation port with pinned host and returns no fabricated lease', async () => {
    expect(await create()).toBeNull()
    expect(ordinary).toHaveBeenCalledTimes(1)
    expect(ordinary).toHaveBeenCalledWith(
      'workspace-a',
      'untitled.md',
      undefined,
      undefined,
      'local'
    )
    expect(await readFile(filePath, 'utf8')).toBe('')
    expect(
      await service.discardUntitledPlaceholder(
        'workspace-a',
        'untitled.md',
        CLIENT,
        'no-issued-lease',
        undefined,
        undefined,
        'local'
      )
    ).toEqual({ status: 'unavailable', reason: 'lease-unavailable' })
    expect(await readFile(filePath, 'utf8')).toBe('')
  })

  it('rejects a client disconnected during the first target await before any creation', async () => {
    onResolve = () => service.releaseUntitledPlaceholdersForClient(CLIENT)
    await expect(create()).rejects.toThrow('authority changed')
    expect(ordinary).not.toHaveBeenCalled()
    expect(existsSync(filePath)).toBe(false)
  })

  it.each(['owner', 'path', 'permission'] as const)(
    'rejects %s changes before ordinary fallback and creates neither target',
    async (change) => {
      let calls = 0
      ports.authorize.mockImplementation(async (path) => {
        if (++calls > 2) {
          if (change === 'owner') {
            service.releaseUntitledPlaceholdersForClient(CLIENT)
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
      await expect(create()).rejects.toThrow()
      expect(ordinary).not.toHaveBeenCalled()
      expect(existsSync(filePath)).toBe(false)
      expect(existsSync(otherPath)).toBe(false)
    }
  )

  it.each(['owner', 'path', 'permission'] as const)(
    'rejects a post-create %s change while keeping the actual created file',
    async (change) => {
      onOrdinaryCreated = () => {
        if (change === 'owner') {
          service.releaseUntitledPlaceholdersForClient(CLIENT)
        }
        if (change === 'path') {
          targetPath = otherPath
        }
        if (change === 'permission') {
          ports.authorize.mockRejectedValue(new Error('Fixture permission revoked after wx'))
        }
      }
      await expect(create()).rejects.toThrow()
      expect(ordinary).toHaveBeenCalledTimes(1)
      expect(await readFile(filePath, 'utf8')).toBe('')
      expect(existsSync(otherPath)).toBe(false)
    }
  )

  it('retains actual existing contents when the ordinary wx port collides', async () => {
    await writeFile(filePath, 'existing ordinary bytes')
    await expect(create()).rejects.toMatchObject({ code: 'EEXIST' })
    expect(ordinary).toHaveBeenCalledTimes(1)
    expect(await readFile(filePath, 'utf8')).toBe('existing ordinary bytes')
  })

  it('does not route an actual retained-source collision through the ordinary creation port', async () => {
    ports.userData = join(directory, 'app-data')
    await mkdir(ports.userData, { mode: 0o700 })
    await writeFile(filePath, 'existing retained-source bytes')
    await expect(create()).rejects.toMatchObject({
      code: 'EEXIST',
      creationStage: 'open-source',
      creationOutcome: 'unknown'
    })
    expect(ordinary).not.toHaveBeenCalled()
    expect(await readFile(filePath, 'utf8')).toBe('existing retained-source bytes')
  })

  it('rejects an operational AppEnvironment error without ordinary creation', async () => {
    const cause = Object.assign(new Error('Fixture AppEnvironment access refused'), {
      code: 'EPERM'
    })
    ports.environmentError = cause
    await expect(create()).rejects.toMatchObject({
      cause,
      code: 'EPERM',
      creationStage: 'resolve-location',
      creationOutcome: 'not-attempted'
    })
    expect(ordinary).not.toHaveBeenCalled()
    expect(existsSync(filePath)).toBe(false)
  })

  it.each([undefined, 'ssh:other'] as const)(
    'never substitutes local create for caller host proof %s',
    async (host) => {
      await expect(
        service.createUntitledPlaceholder(
          'workspace-a',
          'untitled.md',
          CLIENT,
          undefined,
          undefined,
          host
        )
      ).rejects.toThrow()
      expect(ordinary).not.toHaveBeenCalled()
      expect(ports.authorize).not.toHaveBeenCalled()
      expect(existsSync(filePath)).toBe(false)
    }
  )
})
