import { createHash, randomUUID } from 'node:crypto'
import type { BigIntStats } from 'node:fs'
import { lstat, mkdir, open, realpath, rename, link } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { bestEffortFsyncDirectorySync } from './secure-file'
import { restrictWindowsPathAsync } from './secure-path-windows-acl'
import { closeUntitledPlaceholderLease } from './untitled-placeholder-lease-close'
import { failUntitledPlaceholderCreation } from './untitled-placeholder-creation-error'
import {
  assertUntitledPlaceholderOwnerAvailable,
  untitledPlaceholderSameIdentity as sameIdentity,
  untitledPlaceholderPreservationReason as preservationReason
} from './untitled-placeholder-retention-types'
export { UntitledPlaceholderRetentionUnavailableError } from './untitled-placeholder-retention-types'
export { isUntitledPlaceholderOrdinaryCreateUnavailable } from './untitled-placeholder-creation-error'
import type {
  UntitledPlaceholderCreationOutcome,
  UntitledPlaceholderCreationStage,
  UntitledPlaceholderDiscardResult,
  UntitledPlaceholderOriginLease as Lease,
  UntitledPlaceholderRetentionHost,
  UntitledPlaceholderRetentionOptions
} from './untitled-placeholder-retention-types'

const PREFIX = '.hive-untitled-retained-'

async function maybeStat(filePath: string): Promise<BigIntStats | null> {
  try {
    return await lstat(filePath, { bigint: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}
async function canonicalSource(filePath: string): Promise<string> {
  if (!isAbsolute(filePath) || filePath.includes('\0')) {
    throw new Error('Invalid placeholder path')
  }
  return join(await realpath(dirname(filePath)), basename(filePath))
}
async function record(handle: FileHandle, value: unknown): Promise<void> {
  await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8')
  await handle.sync()
}
async function privatePath(filePath: string, directory: boolean): Promise<void> {
  if (process.platform === 'win32') {
    if (!(await restrictWindowsPathAsync(filePath, directory))) {
      throw new Error('ACL unavailable')
    }
  } else if (((await lstat(filePath, { bigint: true })).mode & 0o077n) !== 0n) {
    throw new Error('Private permissions unavailable')
  }
}

class RetentionHost implements UntitledPlaceholderRetentionHost {
  private leases = new Map<string, Lease>()
  private pendingOwners = new Map<string, Promise<unknown>>()
  private releasedOwners = new Set<string>()

  constructor(private options: UntitledPlaceholderRetentionOptions) {}

  private withOwner<T>(ownerKey: string, run: () => Promise<T>): Promise<T> {
    const previous = this.pendingOwners.get(ownerKey) ?? Promise.resolve()
    const pending = previous.then(run, run)
    this.pendingOwners.set(ownerKey, pending)
    return pending.finally(() => {
      if (this.pendingOwners.get(ownerKey) === pending) {
        this.pendingOwners.delete(ownerKey)
      }
    })
  }

  create(filePath: string, ownerKey: string): Promise<string> {
    return this.withOwner(ownerKey, async () => {
      let source: FileHandle | undefined
      let manifest: FileHandle | undefined
      let manifestPath: string | undefined
      let stage: UntitledPlaceholderCreationStage = 'owner'
      let outcome: UntitledPlaceholderCreationOutcome = 'not-attempted'
      try {
        assertUntitledPlaceholderOwnerAvailable(ownerKey, this.releasedOwners)
        stage = 'canonical-path'
        const originalPath = await canonicalSource(filePath)
        stage = 'resolve-location'
        const recoveryRoot = await this.options.resolveRetentionRoot?.(originalPath)
        stage = 'verify-root'
        if (!recoveryRoot || !isAbsolute(recoveryRoot)) {
          throw new Error('Owned recovery root unavailable')
        }
        const rootStat = await lstat(recoveryRoot, { bigint: true })
        const parentStat = await lstat(dirname(originalPath), { bigint: true })
        if (!rootStat.isDirectory() || rootStat.dev !== parentStat.dev) {
          throw new Error('Same filesystem recovery root unavailable')
        }
        await privatePath(recoveryRoot, true)
        const canonicalRoot = await realpath(recoveryRoot)
        if (!sameIdentity(rootStat, await lstat(canonicalRoot, { bigint: true }))) {
          throw new Error('Recovery root identity changed')
        }
        const id = randomUUID()
        const directory = join(canonicalRoot, `${PREFIX}${id}`)
        manifestPath = `${directory}.jsonl`
        const recovery = {
          id,
          originalPath,
          retainedPath: join(directory, 'payload'),
          manifestPath,
          restoredToOriginalPath: false
        }
        stage = 'create-manifest'
        manifest = await open(manifestPath, 'wx', 0o600)
        stage = 'prepare-retention'
        await record(manifest, {
          schema: 'hive-untitled-retention',
          id,
          ownerHash: createHash('sha256').update(ownerKey).digest('hex'),
          originalPath
        })
        await privatePath(manifestPath, false)
        await mkdir(directory, { mode: 0o700 })
        await privatePath(directory, true)
        const directoryStat = await lstat(directory, { bigint: true })
        if (!directoryStat.isDirectory() || directoryStat.dev !== parentStat.dev) {
          throw new Error('Same filesystem unavailable')
        }
        await record(manifest, {
          phase: 'private-directory',
          dev: String(directoryStat.dev),
          ino: String(directoryStat.ino)
        })
        bestEffortFsyncDirectorySync(recoveryRoot)
        stage = 'open-source'
        outcome = 'unknown'
        source = await open(originalPath, 'wx')
        outcome = 'created'
        stage = 'prove-source'
        const identity = await source.stat({ bigint: true })
        if (preservationReason(identity, identity)) {
          throw new Error('Empty origin unavailable')
        }
        await source.sync()
        await record(manifest, {
          phase: 'created',
          dev: String(identity.dev),
          ino: String(identity.ino)
        })
        bestEffortFsyncDirectorySync(dirname(originalPath))
        stage = 'commit-lease'
        await this.options.onPhase?.('before-lease-commit', { ...recovery })
        assertUntitledPlaceholderOwnerAvailable(ownerKey, this.releasedOwners)
        const token = randomUUID()
        this.leases.set(token, {
          ownerKey,
          source,
          manifest,
          directoryIdentity: directoryStat,
          recovery
        })
        return token
      } catch (error) {
        return failUntitledPlaceholderCreation(
          { source, manifest, manifestPath, stage, outcome },
          error,
          ownerKey,
          this.releasedOwners
        )
      }
    })
  }

  discard(
    filePath: string,
    ownerKey: string,
    token: string
  ): Promise<UntitledPlaceholderDiscardResult> {
    return this.withOwner(ownerKey, async () => {
      const lease = this.leases.get(token)
      if (!lease) {
        return { status: 'unavailable', reason: 'lease-unavailable' }
      }
      if (lease.ownerKey !== ownerKey) {
        return { status: 'unavailable', reason: 'lease-owner-mismatch' }
      }
      let captured = false
      try {
        if ((await canonicalSource(filePath)) !== lease.recovery.originalPath) {
          return { status: 'unavailable', reason: 'path-mismatch' }
        }
        const sourcePath = lease.recovery.originalPath
        const observed = await maybeStat(sourcePath)
        if (!observed) {
          return { status: 'unavailable', reason: 'filesystem-unavailable' }
        }
        const origin = await lease.source.stat({ bigint: true })
        const reason = preservationReason(observed, origin)
        if (reason) {
          return { status: 'preserved', reason }
        }
        await record(lease.manifest, { phase: 'prepared-capture' })
        await this.options.onPhase?.('before-capture', { ...lease.recovery })
        const directory = dirname(lease.recovery.retainedPath)
        const directoryStat = await lstat(directory, { bigint: true })
        if (!directoryStat.isDirectory() || !sameIdentity(directoryStat, lease.directoryIdentity)) {
          return { status: 'unavailable', reason: 'filesystem-unavailable' }
        }
        await privatePath(directory, true)
        if (await maybeStat(lease.recovery.retainedPath)) {
          return { status: 'unavailable', reason: 'filesystem-unavailable' }
        }
        await rename(sourcePath, lease.recovery.retainedPath)
        captured = true
        bestEffortFsyncDirectorySync(dirname(sourcePath))
        bestEffortFsyncDirectorySync(dirname(lease.recovery.retainedPath))
        await this.options.onPhase?.('after-capture', { ...lease.recovery })
        const retained = await lstat(lease.recovery.retainedPath, { bigint: true })
        const after = preservationReason(retained, await lease.source.stat({ bigint: true }))
        const result: UntitledPlaceholderDiscardResult = after
          ? await this.restore(lease, after)
          : (await maybeStat(sourcePath))
            ? { status: 'preserved', reason: 'source-recreated', recovery: lease.recovery }
            : { status: 'removed-placeholder', recovery: lease.recovery }
        await record(lease.manifest, {
          phase: 'result',
          status: result.status,
          recovery: lease.recovery
        })
        return result
      } catch {
        // Even a failed rename can have an uncertain outcome; never delete either entry.
        try {
          captured = captured || (await maybeStat(lease.recovery.retainedPath)) !== null
        } catch {
          captured = true
        }
        return captured
          ? {
              status: 'recovery-required',
              reason: 'manifest-or-proof-failed',
              recovery: lease.recovery
            }
          : { status: 'unavailable', reason: 'filesystem-unavailable' }
      } finally {
        if (captured) {
          await this.closeLease(token, lease)
        }
      }
    })
  }

  private async restore(
    lease: Lease,
    reason: NonNullable<ReturnType<typeof preservationReason>>
  ): Promise<UntitledPlaceholderDiscardResult> {
    const recovery = lease.recovery
    if (!(await lstat(recovery.retainedPath)).isFile()) {
      return { status: 'recovery-required', reason: 'restore-failed', recovery }
    }
    await this.options.onPhase?.('before-restore', { ...recovery })
    try {
      await link(recovery.retainedPath, recovery.originalPath)
      recovery.restoredToOriginalPath = true
      bestEffortFsyncDirectorySync(dirname(recovery.originalPath))
      return { status: 'preserved', reason, recovery }
    } catch {
      return { status: 'recovery-required', reason: 'restore-failed', recovery }
    }
  }

  private async closeLease(token: string, lease: Lease): Promise<void> {
    await closeUntitledPlaceholderLease(lease, this.options.onBeforeLeaseClose)
    this.leases.delete(token)
  }

  release(ownerKey: string, token: string): Promise<void> {
    return this.withOwner(ownerKey, async () => {
      const lease = this.leases.get(token)
      if (!lease) {
        return
      }
      if (lease.ownerKey !== ownerKey) {
        throw new Error('Placeholder lease owner mismatch')
      }
      await this.closeLease(token, lease)
    })
  }

  releaseOwner(ownerKey: string): Promise<void> {
    this.releasedOwners.add(ownerKey)
    return this.withOwner(ownerKey, async () => {
      const results = await Promise.allSettled(
        [...this.leases]
          .filter(([, lease]) => lease.ownerKey === ownerKey)
          .map(([token, lease]) => this.closeLease(token, lease))
      )
      const errors = results
        .filter((result) => result.status === 'rejected')
        .map((result) => result.reason)
      if (errors.length) {
        throw new AggregateError(errors, 'Placeholder owner release failed')
      }
    })
  }
}

export function createUntitledPlaceholderRetentionHost(
  options: UntitledPlaceholderRetentionOptions = {}
): UntitledPlaceholderRetentionHost {
  return new RetentionHost(options)
}
