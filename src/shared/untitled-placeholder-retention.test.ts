import {
  mkdtemp,
  mkdir,
  lstat,
  open,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createUntitledPlaceholderRetentionHost,
  UntitledPlaceholderRetentionUnavailableError,
  isUntitledPlaceholderOrdinaryCreateUnavailable
} from './untitled-placeholder-retention'
import { UntitledPlaceholderRecoveryLocationUnavailableError } from './untitled-placeholder-recovery-directory'
import { UntitledPlaceholderLeaseCloseError } from './untitled-placeholder-retention-types'
import type {
  UntitledPlaceholderRecovery,
  UntitledPlaceholderRetentionHost,
  UntitledPlaceholderRetentionOptions
} from './untitled-placeholder-retention-types'

const OWNER = 'authenticated-owner-a'
const OTHER_OWNER = 'authenticated-owner-b'
let directory: string
let filePath: string
let recoveryRoot: string
let hosts: UntitledPlaceholderRetentionHost[]
let externalHandles: FileHandle[]
let extraDirectories: string[]

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }
}
function host(options?: UntitledPlaceholderRetentionOptions): UntitledPlaceholderRetentionHost {
  const instance = createUntitledPlaceholderRetentionHost({
    resolveRetentionRoot: async () => recoveryRoot,
    ...options
  })
  hosts.push(instance)
  return instance
}
async function writer(): Promise<FileHandle> {
  const handle = await open(filePath, 'r+')
  externalHandles.push(handle)
  return handle
}
async function replaceWithDirectoryLink(): Promise<void> {
  const target = join(directory, 'link-target')
  await mkdir(target)
  await writeFile(join(target, 'keep'), 'linked target data')
  await rename(filePath, join(directory, 'original.md'))
  await symlink(target, filePath, 'junction')
}
async function assertRetained(
  recovery: UntitledPlaceholderRecovery,
  content: string
): Promise<void> {
  expect(await readFile(recovery.retainedPath, 'utf8')).toBe(content)
  const lines = (await readFile(recovery.manifestPath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(lines[0]).toMatchObject({ schema: 'hive-untitled-retention', id: recovery.id })
  expect(lines.some((entry) => entry.phase === 'private-directory')).toBe(true)
}

beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'hive-untitled-retention-')))
  filePath = join(directory, 'untitled.md')
  recoveryRoot = join(directory, 'host-owned-recovery')
  await mkdir(recoveryRoot, { mode: 0o700 })
  hosts = []
  externalHandles = []
  extraDirectories = []
})
afterEach(async () => {
  await Promise.all(
    hosts.flatMap((instance) => [instance.releaseOwner(OWNER), instance.releaseOwner(OTHER_OWNER)])
  )
  await Promise.all(externalHandles.map((handle) => handle.close()))
  for (const owned of extraDirectories) {
    await rm(owned, { recursive: true, force: true })
    expect(await exists(owned)).toBe(false)
  }
  await rm(directory, { recursive: true, force: true })
  expect(await exists(directory)).toBe(false)
})

describe('actual host untitled placeholder retention', () => {
  it('reports real recovery paths after an exact owned descriptor close fault and permits exact release', async () => {
    const fault = Object.assign(new Error('Exact owned source descriptor close fault'), {
      code: 'EIO'
    })
    let sourceHandle: FileHandle | undefined
    let nativeClose: (() => Promise<void>) | undefined
    let recovery: UntitledPlaceholderRecovery | undefined
    let injected = false
    const service = host({
      onPhase: async (phase, observed) => {
        if (phase === 'after-capture') {
          recovery = { ...observed }
        }
      },
      onBeforeLeaseClose: (source) => {
        if (!injected) {
          sourceHandle = source
          nativeClose = source.close.bind(source)
          source.close = async () => {
            throw fault
          }
          injected = true
        } else if (source === sourceHandle && nativeClose) {
          source.close = nativeClose
        }
      }
    })
    const token = await service.create(filePath, OWNER)
    const origin = await lstat(filePath, { bigint: true })
    let failure: unknown
    try {
      await service.discard(filePath, OWNER, token)
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(UntitledPlaceholderLeaseCloseError)
    if (!(failure instanceof UntitledPlaceholderLeaseCloseError) || !recovery || !sourceHandle) {
      throw new Error('Exact descriptor fault was not observed')
    }
    expect(failure.cause).toBe(fault)
    expect(failure.recovery).toEqual(recovery)
    expect(failure.message).toContain(recovery.retainedPath)
    expect(failure.message).toContain(recovery.manifestPath)
    expect(await exists(filePath)).toBe(false)
    expect((await sourceHandle.stat({ bigint: true })).ino).toBe(origin.ino)
    await sourceHandle.writeFile('late data while exact close is pending')
    await sourceHandle.sync()
    await assertRetained(recovery, 'late data while exact close is pending')
    await service.release(OWNER, token)
    expect(sourceHandle.fd).toBe(-1)
    expect(await service.discard(filePath, OWNER, token)).toEqual({
      status: 'unavailable',
      reason: 'lease-unavailable'
    })
    await assertRetained(recovery, 'late data while exact close is pending')
  })

  it('cannot return a new lease after owner revocation during real creation', async () => {
    let releasing: Promise<void> | undefined
    let recovery: UntitledPlaceholderRecovery | undefined
    const service: UntitledPlaceholderRetentionHost = host({
      onPhase: async (phase, observed) => {
        if (phase === 'before-lease-commit') {
          recovery = { ...observed }
          await writeFile(filePath, 'late data at disconnect')
          releasing = service.releaseOwner(OWNER)
        }
      }
    })
    await expect(service.create(filePath, OWNER)).rejects.toBeInstanceOf(
      UntitledPlaceholderRetentionUnavailableError
    )
    if (!releasing || !recovery) {
      throw new Error('Actual creation phase was not observed')
    }
    await releasing
    expect(await readFile(filePath, 'utf8')).toBe('late data at disconnect')
    expect(await readFile(recovery.manifestPath, 'utf8')).toContain('create-failed')
    expect(await exists(recovery.retainedPath)).toBe(false)
    await expect(
      service.create(join(directory, 'after-revocation.md'), OWNER)
    ).rejects.toBeInstanceOf(UntitledPlaceholderRetentionUnavailableError)
    expect(await exists(join(directory, 'after-revocation.md'))).toBe(false)
  })

  it('honors the real filesystem boundary before creating a placeholder', async () => {
    const base = join('logs', 'final-repair-8', 'untitled-retention-host', 'device-fixtures')
    await mkdir(base, { recursive: true })
    const outside = await realpath(await mkdtemp(join(base, 'owned-')))
    extraDirectories.push(outside)
    const probe = join(directory, 'volume-probe')
    await writeFile(probe, 'device boundary proof')
    let crossDevice = false
    try {
      await rename(probe, join(outside, 'volume-probe'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') {
        throw error
      }
      crossDevice = true
    }
    const service = host({ resolveRetentionRoot: async () => outside })
    if (crossDevice) {
      await expect(service.create(filePath, OWNER)).rejects.toBeInstanceOf(
        UntitledPlaceholderRetentionUnavailableError
      )
      expect(await exists(filePath)).toBe(false)
      expect(await readFile(probe, 'utf8')).toBe('device boundary proof')
    } else {
      const token = await service.create(filePath, OWNER)
      const result = await service.discard(filePath, OWNER, token)
      expect(result.status).toBe('removed-placeholder')
      if (result.status !== 'removed-placeholder') {
        throw new Error('Actual same-device capture failed')
      }
      expect(result.recovery.retainedPath.startsWith(outside)).toBe(true)
      await assertRetained(result.recovery, '')
    }
  })

  it('requires an actual host-owned recovery root instead of persisting files beside the source', async () => {
    const service = createUntitledPlaceholderRetentionHost()
    hosts.push(service)
    await expect(service.create(filePath, OWNER)).rejects.toBeInstanceOf(
      UntitledPlaceholderRetentionUnavailableError
    )
    expect(await exists(filePath)).toBe(false)
  })

  it('rejects a symlink/junction recovery root before creating any placeholder', async () => {
    const linkedRoot = join(directory, 'linked-recovery')
    await symlink(recoveryRoot, linkedRoot, 'junction')
    const service = host({ resolveRetentionRoot: async () => linkedRoot })
    await expect(service.create(filePath, OWNER)).rejects.toBeInstanceOf(
      UntitledPlaceholderRetentionUnavailableError
    )
    expect(await exists(filePath)).toBe(false)
    expect((await lstat(linkedRoot)).isSymbolicLink()).toBe(true)
  })

  it('removes the visible empty placeholder while retaining its original object and real manifest', async () => {
    const service = host()
    const token = await service.create(filePath, OWNER)
    const origin = await lstat(filePath, { bigint: true })
    const result = await service.discard(filePath, OWNER, token)
    expect(result.status).toBe('removed-placeholder')
    if (result.status !== 'removed-placeholder') {
      throw new Error('Actual capture failed')
    }
    expect(await exists(filePath)).toBe(false)
    const retained = await lstat(result.recovery.retainedPath, { bigint: true })
    expect([retained.dev, retained.ino, retained.size]).toEqual([origin.dev, origin.ino, 0n])
    await assertRetained(result.recovery, '')
    const header = JSON.parse((await readFile(result.recovery.manifestPath, 'utf8')).split('\n')[0])
    expect(header.originalPath).toBe(filePath)
    expect(await readFile(result.recovery.manifestPath, 'utf8')).not.toContain(token)
    expect(await service.discard(filePath, OWNER, token)).toEqual({
      status: 'unavailable',
      reason: 'lease-unavailable'
    })
  })

  it('retains a real late write through a descriptor opened before successful capture', async () => {
    const service = host()
    const token = await service.create(filePath, OWNER)
    const handle = await writer()
    const origin = await handle.stat({ bigint: true })
    const result = await service.discard(filePath, OWNER, token)
    expect(result.status).toBe('removed-placeholder')
    if (result.status !== 'removed-placeholder') {
      throw new Error('Actual capture failed')
    }
    await handle.writeFile('late write 晚写\n')
    await handle.sync()
    await assertRetained(result.recovery, 'late write 晚写\n')
    expect((await lstat(result.recovery.retainedPath, { bigint: true })).ino).toBe(origin.ino)
    expect(await exists(filePath)).toBe(false)
  })

  it('preserves real nonempty contents before capture', async () => {
    const service = host()
    const token = await service.create(filePath, OWNER)
    await writeFile(filePath, 'external contents')
    expect(await service.discard(filePath, OWNER, token)).toEqual({
      status: 'preserved',
      reason: 'not-empty'
    })
    expect(await readFile(filePath, 'utf8')).toBe('external contents')
  })

  it('rejects a new empty object at the old path despite the identical empty content', async () => {
    const service = host()
    const token = await service.create(filePath, OWNER)
    await rename(filePath, join(directory, 'original.md'))
    await writeFile(filePath, '')
    const replacement = await lstat(filePath, { bigint: true })
    expect(await service.discard(filePath, OWNER, token)).toEqual({
      status: 'preserved',
      reason: 'identity-changed'
    })
    expect((await lstat(filePath, { bigint: true })).ino).toBe(replacement.ino)
    expect(await readFile(join(directory, 'original.md'), 'utf8')).toBe('')
  })

  it('preserves a directory replacement before capture', async () => {
    const service = host()
    const token = await service.create(filePath, OWNER)
    await rename(filePath, join(directory, 'original.md'))
    await mkdir(filePath)
    await writeFile(join(filePath, 'keep'), 'directory data')
    expect(await service.discard(filePath, OWNER, token)).toEqual({
      status: 'preserved',
      reason: 'not-regular-file'
    })
    expect(await readFile(join(filePath, 'keep'), 'utf8')).toBe('directory data')
  })

  it('preserves a real directory symlink without following its target', async () => {
    const service = host()
    const token = await service.create(filePath, OWNER)
    await replaceWithDirectoryLink()
    expect(await service.discard(filePath, OWNER, token)).toEqual({
      status: 'preserved',
      reason: 'not-regular-file'
    })
    expect((await lstat(filePath)).isSymbolicLink()).toBe(true)
    expect(await readFile(join(directory, 'link-target', 'keep'), 'utf8')).toBe(
      'linked target data'
    )
  })

  it('restores a replacement captured after initial eligibility without unlinking its retained object', async () => {
    const service = host({
      onPhase: async (phase) => {
        if (phase === 'before-capture') {
          await rename(filePath, join(directory, 'original.md'))
          await writeFile(filePath, '')
        }
      }
    })
    const token = await service.create(filePath, OWNER)
    const origin = await lstat(filePath, { bigint: true })
    const result = await service.discard(filePath, OWNER, token)
    expect(result).toMatchObject({
      status: 'preserved',
      reason: 'identity-changed',
      recovery: { restoredToOriginalPath: true }
    })
    if (!('recovery' in result) || !result.recovery) {
      throw new Error('Missing actual recovery')
    }
    await assertRetained(result.recovery, '')
    const restored = await lstat(filePath, { bigint: true })
    expect(restored.ino).not.toBe(origin.ino)
    expect(restored.ino).toBe((await lstat(result.recovery.retainedPath, { bigint: true })).ino)
  })

  it.each(['before-capture', 'after-capture'] as const)(
    'restores a real nonempty write at %s',
    async (writePhase) => {
      let handle: FileHandle
      const service = host({
        onPhase: async (phase) => {
          if (phase === writePhase) {
            await handle.writeFile('race data 完整')
          }
        }
      })
      const token = await service.create(filePath, OWNER)
      handle = await writer()
      const result = await service.discard(filePath, OWNER, token)
      expect(result).toMatchObject({
        status: 'preserved',
        reason: 'not-empty',
        recovery: { restoredToOriginalPath: true }
      })
      if (!('recovery' in result) || !result.recovery) {
        throw new Error('Missing actual recovery')
      }
      expect(await readFile(filePath, 'utf8')).toBe('race data 完整')
      await assertRetained(result.recovery, 'race data 完整')
    }
  )

  it('retains a captured directory and its children with a truthful recovery-required result', async () => {
    const service = host({
      onPhase: async (phase) => {
        if (phase === 'before-capture') {
          await rename(filePath, join(directory, 'original.md'))
          await mkdir(filePath)
          await writeFile(join(filePath, 'keep'), 'directory race data')
        }
      }
    })
    const token = await service.create(filePath, OWNER)
    const result = await service.discard(filePath, OWNER, token)
    expect(result).toMatchObject({ status: 'recovery-required', reason: 'restore-failed' })
    if (result.status !== 'recovery-required') {
      throw new Error('Missing actual recovery')
    }
    expect(await exists(filePath)).toBe(false)
    expect((await lstat(result.recovery.retainedPath)).isDirectory()).toBe(true)
    expect(await readFile(join(result.recovery.retainedPath, 'keep'), 'utf8')).toBe(
      'directory race data'
    )
    expect(await exists(result.recovery.manifestPath)).toBe(true)
  })

  it('retains a captured junction/symlink without following or deleting its target', async () => {
    const service = host({
      onPhase: async (phase) => {
        if (phase === 'before-capture') {
          await replaceWithDirectoryLink()
        }
      }
    })
    const token = await service.create(filePath, OWNER)
    const result = await service.discard(filePath, OWNER, token)
    expect(result).toMatchObject({ status: 'recovery-required', reason: 'restore-failed' })
    if (result.status !== 'recovery-required') {
      throw new Error('Missing actual recovery')
    }
    expect((await lstat(result.recovery.retainedPath)).isSymbolicLink()).toBe(true)
    expect(await readFile(join(directory, 'link-target', 'keep'), 'utf8')).toBe(
      'linked target data'
    )
    expect(await exists(filePath)).toBe(false)
  })

  it('does not overwrite a new target when real exclusive restoration loses the race', async () => {
    const service = host({
      onPhase: async (phase) => {
        if (phase === 'before-capture') {
          await writeFile(filePath, 'captured original content')
        }
        if (phase === 'before-restore') {
          await writeFile(filePath, 'replacement wins')
        }
      }
    })
    const token = await service.create(filePath, OWNER)
    const result = await service.discard(filePath, OWNER, token)
    expect(result).toMatchObject({
      status: 'recovery-required',
      reason: 'restore-failed',
      recovery: { restoredToOriginalPath: false }
    })
    if (result.status !== 'recovery-required') {
      throw new Error('Missing actual recovery')
    }
    expect(await readFile(filePath, 'utf8')).toBe('replacement wins')
    await assertRetained(result.recovery, 'captured original content')
  })

  it('leaves a newly recreated visible source intact after an empty capture', async () => {
    const service = host({
      onPhase: async (phase) => {
        if (phase === 'after-capture') {
          await writeFile(filePath, 'new visible contents')
        }
      }
    })
    const token = await service.create(filePath, OWNER)
    const result = await service.discard(filePath, OWNER, token)
    expect(result).toMatchObject({ status: 'preserved', reason: 'source-recreated' })
    if (!('recovery' in result) || !result.recovery) {
      throw new Error('Missing actual recovery')
    }
    expect(await readFile(filePath, 'utf8')).toBe('new visible contents')
    await assertRetained(result.recovery, '')
  })

  it('rejects owner, path and token mismatches without capturing a file', async () => {
    let capturePhases = 0
    const service = host({
      onPhase: async (phase) => {
        if (phase !== 'before-lease-commit') {
          capturePhases += 1
        }
      }
    })
    const token = await service.create(filePath, OWNER)
    expect(await service.discard(filePath, OTHER_OWNER, token)).toEqual({
      status: 'unavailable',
      reason: 'lease-owner-mismatch'
    })
    expect(await service.discard(join(directory, 'different.md'), OWNER, token)).toEqual({
      status: 'unavailable',
      reason: 'path-mismatch'
    })
    expect(await service.discard(filePath, OWNER, 'invented token')).toEqual({
      status: 'unavailable',
      reason: 'lease-unavailable'
    })
    await expect(service.release(OTHER_OWNER, token)).rejects.toThrow('owner mismatch')
    expect(capturePhases).toBe(0)
    expect(await readFile(filePath, 'utf8')).toBe('')
  })

  it('rejects exclusive creation collisions and leaves existing user contents intact', async () => {
    const service = host()
    await writeFile(filePath, 'existing contents')
    let creationError: unknown
    try {
      await service.create(filePath, OWNER)
    } catch (error) {
      creationError = error
    }
    expect(creationError).toBeInstanceOf(UntitledPlaceholderRetentionUnavailableError)
    if (!(creationError instanceof UntitledPlaceholderRetentionUnavailableError)) {
      throw new Error('Missing failure')
    }
    expect(await readFile(filePath, 'utf8')).toBe('existing contents')
    expect(creationError.code).toBe('EEXIST')
    expect(creationError.message).toContain('EEXIST')
    expect(creationError.manifestPath).toBeTypeOf('string')
    expect(await readFile(creationError.manifestPath!, 'utf8')).toContain('create-failed')
  })

  it('releases exact leases and owners while keeping another owner live', async () => {
    const service = host()
    const token = await service.create(filePath, OWNER)
    const otherPath = join(directory, 'other.md')
    const otherToken = await service.create(otherPath, OTHER_OWNER)
    await service.releaseOwner(OWNER)
    expect(await service.discard(filePath, OWNER, token)).toEqual({
      status: 'unavailable',
      reason: 'lease-unavailable'
    })
    expect(await readFile(filePath, 'utf8')).toBe('')
    await expect(service.create(join(directory, 'denied.md'), OWNER)).rejects.toBeInstanceOf(
      UntitledPlaceholderRetentionUnavailableError
    )
    expect(await exists(join(directory, 'denied.md'))).toBe(false)
    expect((await service.discard(otherPath, OTHER_OWNER, otherToken)).status).toBe(
      'removed-placeholder'
    )
  })

  it('reads an exact real manifest in a fresh host without reconstructing lease authority', async () => {
    const service = host()
    const token = await service.create(filePath, OWNER)
    const result = await service.discard(filePath, OWNER, token)
    if (result.status !== 'removed-placeholder') {
      throw new Error('Actual capture failed')
    }
    const restarted = host()
    expect(await restarted.discard(filePath, OWNER, token)).toEqual({
      status: 'unavailable',
      reason: 'lease-unavailable'
    })
    const header = JSON.parse((await readFile(result.recovery.manifestPath, 'utf8')).split('\n')[0])
    expect(header).toMatchObject({ id: result.recovery.id, originalPath: filePath })
    await assertRetained(result.recovery, '')
  })

  it.each(['before-capture', 'after-capture'] as const)(
    'keeps actual objects when a phase fails at %s',
    async (failurePhase) => {
      let recovery: UntitledPlaceholderRecovery | undefined
      const service = host({
        onPhase: async (phase, observed) => {
          recovery = { ...observed }
          if (phase === failurePhase) {
            throw new Error('Observed host phase failure')
          }
        }
      })
      const token = await service.create(filePath, OWNER)
      const result = await service.discard(filePath, OWNER, token)
      expect(result.status).toBe(
        failurePhase === 'before-capture' ? 'unavailable' : 'recovery-required'
      )
      if (!recovery) {
        throw new Error('Missing actual phase')
      }
      expect(await exists(filePath)).toBe(failurePhase === 'before-capture')
      expect(await exists(recovery.retainedPath)).toBe(failurePhase === 'after-capture')
      expect(
        await readFile(failurePhase === 'before-capture' ? filePath : recovery.retainedPath, 'utf8')
      ).toBe('')
      expect(await exists(recovery.manifestPath)).toBe(true)
    }
  )

  it('refuses an observed occupied private capture destination without clobbering either file', async () => {
    let recovery: UntitledPlaceholderRecovery | undefined
    const service = host({
      onPhase: async (phase, observed) => {
        if (phase === 'before-capture') {
          recovery = { ...observed }
          await writeFile(observed.retainedPath, 'private destination contents')
        }
      }
    })
    const token = await service.create(filePath, OWNER)
    expect((await service.discard(filePath, OWNER, token)).status).toBe('unavailable')
    if (!recovery) {
      throw new Error('Missing actual phase')
    }
    expect(await readFile(filePath, 'utf8')).toBe('')
    expect(await readFile(recovery.retainedPath, 'utf8')).toBe('private destination contents')
  })

  it('refuses an observed replacement of the owned isolation directory', async () => {
    const service = host({
      onPhase: async (phase, observed) => {
        if (phase === 'before-capture') {
          const isolation = dirname(observed.retainedPath)
          await rename(isolation, `${isolation}-original`)
          await mkdir(isolation)
        }
      }
    })
    const token = await service.create(filePath, OWNER)
    expect((await service.discard(filePath, OWNER, token)).status).toBe('unavailable')
    expect(await readFile(filePath, 'utf8')).toBe('')
  })
})

describe('ordinary creation fallback proof', () => {
  it('permits only the typed terminal resolver refusal before any source or manifest creation', async () => {
    const cause = new UntitledPlaceholderRecoveryLocationUnavailableError('No qualified location')
    const service = host({
      resolveRetentionRoot: async () => {
        throw cause
      }
    })
    let failure: unknown
    try {
      await service.create(filePath, OWNER)
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(UntitledPlaceholderRetentionUnavailableError)
    if (!(failure instanceof UntitledPlaceholderRetentionUnavailableError)) {
      throw new Error('Terminal resolver failure was not observed')
    }
    expect(failure.cause).toBe(cause)
    expect(failure.creationStage).toBe('resolve-location')
    expect(failure.creationOutcome).toBe('not-attempted')
    expect(failure.manifestPath).toBeUndefined()
    expect(isUntitledPlaceholderOrdinaryCreateUnavailable(failure)).toBe(true)
    expect(await exists(filePath)).toBe(false)
    expect((await lstat(recoveryRoot)).isDirectory()).toBe(true)
  })

  it.each([
    ['owner', 'not-attempted', undefined],
    ['canonical-path', 'not-attempted', undefined],
    ['verify-root', 'not-attempted', undefined],
    ['create-manifest', 'not-attempted', undefined],
    ['prepare-retention', 'not-attempted', undefined],
    ['open-source', 'unknown', undefined],
    ['prove-source', 'created', undefined],
    ['commit-lease', 'created', undefined],
    ['resolve-location', 'unknown', undefined],
    ['resolve-location', 'created', undefined],
    ['resolve-location', 'not-attempted', 'actual-manifest-path'],
    ['unknown', 'not-attempted', undefined]
  ] as const)(
    'denies the same typed cause at %s with %s and manifest %s',
    (stage, outcome, manifest) => {
      const cause = new UntitledPlaceholderRecoveryLocationUnavailableError('No qualified location')
      const failure = new UntitledPlaceholderRetentionUnavailableError(
        manifest,
        cause,
        stage,
        outcome
      )
      expect(failure.cause).toBe(cause)
      expect(isUntitledPlaceholderOrdinaryCreateUnavailable(failure)).toBe(false)
    }
  )

  it('denies absent or message-only resolver proof and generic ACL or metadata failures', () => {
    for (const cause of [
      new Error('A private recovery location on this filesystem is unavailable'),
      new Error('ACL unavailable'),
      new Error('Git recovery metadata is inside the committable worktree'),
      { name: 'UntitledPlaceholderRecoveryLocationUnavailableError' }
    ]) {
      const failure = new UntitledPlaceholderRetentionUnavailableError(
        undefined,
        cause,
        'resolve-location',
        'not-attempted'
      )
      expect(isUntitledPlaceholderOrdinaryCreateUnavailable(failure)).toBe(false)
    }
    const typedCause = new UntitledPlaceholderRecoveryLocationUnavailableError(
      'No qualified location'
    )
    expect(isUntitledPlaceholderOrdinaryCreateUnavailable(typedCause)).toBe(false)
    expect(
      isUntitledPlaceholderOrdinaryCreateUnavailable(
        new UntitledPlaceholderRetentionUnavailableError(undefined, typedCause)
      )
    ).toBe(false)
  })

  it.each(['EEXIST', 'EACCES'] as const)(
    'never authorizes fallback for a typed cause carrying %s',
    (code) => {
      const cause = Object.assign(
        new UntitledPlaceholderRecoveryLocationUnavailableError('No qualified location'),
        { code }
      )
      const failure = new UntitledPlaceholderRetentionUnavailableError(
        undefined,
        cause,
        'resolve-location',
        'not-attempted'
      )
      expect(failure.code).toBe(code)
      expect(isUntitledPlaceholderOrdinaryCreateUnavailable(failure)).toBe(false)
    }
  )

  it.each(['owner', 'canonical-path'] as const)(
    'keeps a real %s failure distinct from an unavailable recovery location',
    async (stage) => {
      let resolverCalls = 0
      const service = host({
        resolveRetentionRoot: async () => {
          resolverCalls += 1
          throw new UntitledPlaceholderRecoveryLocationUnavailableError('No qualified location')
        }
      })
      let failure: unknown
      try {
        await service.create(
          stage === 'canonical-path' ? 'relative.md' : filePath,
          stage === 'owner' ? '' : OWNER
        )
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(UntitledPlaceholderRetentionUnavailableError)
      expect(failure).toMatchObject({ creationStage: stage, creationOutcome: 'not-attempted' })
      expect(resolverCalls).toBe(0)
      expect(isUntitledPlaceholderOrdinaryCreateUnavailable(failure)).toBe(false)
      expect(await exists(filePath)).toBe(false)
    }
  )

  it('denies the same typed cause after actual creation and preserves its real object and manifest', async () => {
    const cause = new UntitledPlaceholderRecoveryLocationUnavailableError('No qualified location')
    const service = host({
      onPhase: async (phase) => {
        if (phase === 'before-lease-commit') {
          await writeFile(filePath, 'created data must not be recreated')
          throw cause
        }
      }
    })
    let failure: unknown
    try {
      await service.create(filePath, OWNER)
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(UntitledPlaceholderRetentionUnavailableError)
    if (!(failure instanceof UntitledPlaceholderRetentionUnavailableError)) {
      throw new Error('Actual post-creation failure was not observed')
    }
    expect(failure.cause).toBe(cause)
    expect(failure.creationStage).toBe('commit-lease')
    expect(failure.creationOutcome).toBe('created')
    expect(failure.manifestPath).toBeTypeOf('string')
    expect(isUntitledPlaceholderOrdinaryCreateUnavailable(failure)).toBe(false)
    expect(await readFile(filePath, 'utf8')).toBe('created data must not be recreated')
    expect(await readFile(failure.manifestPath!, 'utf8')).toContain('create-failed')
  })

  it('keeps a real exclusive-open collision unknown and never authorizes fallback', async () => {
    await writeFile(filePath, 'existing data')
    let failure: unknown
    try {
      await host().create(filePath, OWNER)
    } catch (error) {
      failure = error
    }
    expect(failure).toMatchObject({
      code: 'EEXIST',
      creationStage: 'open-source',
      creationOutcome: 'unknown'
    })
    expect(isUntitledPlaceholderOrdinaryCreateUnavailable(failure)).toBe(false)
    expect(await readFile(filePath, 'utf8')).toBe('existing data')
  })

  it('rejects fallback when the owner is revoked during a typed terminal resolver refusal', async () => {
    let releasing: Promise<void> | undefined
    const cause = new UntitledPlaceholderRecoveryLocationUnavailableError('No qualified location')
    const service = host({
      resolveRetentionRoot: async () => {
        releasing = service.releaseOwner(OWNER)
        throw cause
      }
    })
    let failure: unknown
    try {
      await service.create(filePath, OWNER)
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(UntitledPlaceholderRetentionUnavailableError)
    expect(failure).toMatchObject({ creationStage: 'owner', creationOutcome: 'not-attempted' })
    expect((failure as Error).cause).not.toBe(cause)
    expect(isUntitledPlaceholderOrdinaryCreateUnavailable(failure)).toBe(false)
    expect(releasing).toBeDefined()
    await releasing
    expect(await exists(filePath)).toBe(false)
  })
})
