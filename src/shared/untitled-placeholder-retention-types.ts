import type { BigIntStats } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'

export type UntitledPlaceholderCreationStage =
  | 'unknown'
  | 'owner'
  | 'canonical-path'
  | 'resolve-location'
  | 'verify-root'
  | 'create-manifest'
  | 'prepare-retention'
  | 'open-source'
  | 'prove-source'
  | 'commit-lease'

export type UntitledPlaceholderCreationOutcome = 'not-attempted' | 'unknown' | 'created'

export class UntitledPlaceholderRetentionUnavailableError extends Error {
  readonly code: string | undefined

  constructor(
    readonly manifestPath: string | undefined,
    cause: unknown,
    readonly creationStage: UntitledPlaceholderCreationStage = 'unknown',
    readonly creationOutcome: UntitledPlaceholderCreationOutcome = 'unknown'
  ) {
    const error = cause instanceof Error ? cause : undefined
    const code = error && 'code' in error && typeof error.code === 'string' ? error.code : undefined
    super(
      code === 'EEXIST' && error
        ? error.message
        : 'Safe untitled placeholder retention is unavailable',
      { cause }
    )
    this.code = code
    this.name = 'UntitledPlaceholderRetentionUnavailableError'
  }
}

export type UntitledPlaceholderRecovery = {
  id: string
  originalPath: string
  retainedPath: string
  manifestPath: string
  restoredToOriginalPath: boolean
}

export class UntitledPlaceholderLeaseCloseError extends Error {
  readonly recovery: UntitledPlaceholderRecovery

  constructor(recovery: UntitledPlaceholderRecovery, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    super(
      `Placeholder lease close failed: ${detail}. Original path: ${recovery.originalPath}. Recovery payload path: ${recovery.retainedPath}. Recovery manifest: ${recovery.manifestPath}.`,
      { cause }
    )
    this.name = 'UntitledPlaceholderLeaseCloseError'
    this.recovery = { ...recovery }
  }
}

export type UntitledPlaceholderOriginLease = {
  ownerKey: string
  source: FileHandle
  manifest: FileHandle
  directoryIdentity: BigIntStats
  recovery: UntitledPlaceholderRecovery
}

export function untitledPlaceholderSameIdentity(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.ino !== 0n
}

export function untitledPlaceholderPreservationReason(stat: BigIntStats, origin: BigIntStats) {
  if (!stat.isFile()) {
    return 'not-regular-file' as const
  }
  if (!untitledPlaceholderSameIdentity(stat, origin)) {
    return 'identity-changed' as const
  }
  if (stat.size !== 0n || origin.size !== 0n) {
    return 'not-empty' as const
  }
  if (stat.nlink !== 1n) {
    return 'hard-linked' as const
  }
  return null
}

export function assertUntitledPlaceholderOwnerAvailable(
  ownerKey: string,
  revoked: ReadonlySet<string>
): void {
  if (!ownerKey || revoked.has(ownerKey)) {
    throw new Error('Placeholder owner unavailable')
  }
}

export type UntitledPlaceholderDiscardResult =
  | { status: 'removed-placeholder'; recovery: UntitledPlaceholderRecovery }
  | {
      status: 'preserved'
      reason:
        | 'not-empty'
        | 'identity-changed'
        | 'not-regular-file'
        | 'hard-linked'
        | 'source-recreated'
      recovery?: UntitledPlaceholderRecovery
    }
  | {
      status: 'recovery-required'
      reason: 'restore-failed' | 'capture-outcome-unknown' | 'manifest-or-proof-failed'
      recovery: UntitledPlaceholderRecovery
    }
  | {
      status: 'unavailable'
      reason:
        | 'lease-unavailable'
        | 'lease-owner-mismatch'
        | 'path-mismatch'
        | 'filesystem-unavailable'
        | 'host-capability-unavailable'
    }

export type UntitledPlaceholderRetentionPhase =
  | 'before-lease-commit'
  | 'before-capture'
  | 'after-capture'
  | 'before-restore'

export type UntitledPlaceholderRetentionOptions = {
  /** Trusted host resolver: an application-owned or verified Git-metadata recovery directory. */
  resolveRetentionRoot?: (sourcePath: string) => Promise<string>
  /** Host-local fault/observation seam; never supplied by a filesystem RPC caller. */
  onBeforeLeaseClose?: (source: FileHandle) => void | Promise<void>
  onPhase?: (
    phase: UntitledPlaceholderRetentionPhase,
    recovery: Readonly<UntitledPlaceholderRecovery>
  ) => Promise<void>
}

/** Callers authorize paths and bind ownerKey to their actual authenticated client. */
export type UntitledPlaceholderRetentionHost = {
  create(filePath: string, ownerKey: string): Promise<string>
  discard(
    filePath: string,
    ownerKey: string,
    token: string
  ): Promise<UntitledPlaceholderDiscardResult>
  release(ownerKey: string, token: string): Promise<void>
  releaseOwner(ownerKey: string): Promise<void>
}
