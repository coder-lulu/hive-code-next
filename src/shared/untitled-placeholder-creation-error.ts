import type { FileHandle } from 'node:fs/promises'
import { UntitledPlaceholderRecoveryLocationUnavailableError } from './untitled-placeholder-recovery-directory'
import {
  UntitledPlaceholderRetentionUnavailableError,
  assertUntitledPlaceholderOwnerAvailable
} from './untitled-placeholder-retention-types'
import type {
  UntitledPlaceholderCreationOutcome,
  UntitledPlaceholderCreationStage
} from './untitled-placeholder-retention-types'

/** Only the terminal resolver refusal proves no source creation was attempted. */
export function isUntitledPlaceholderOrdinaryCreateUnavailable(
  error: unknown
): error is UntitledPlaceholderRetentionUnavailableError {
  return (
    error instanceof UntitledPlaceholderRetentionUnavailableError &&
    error.creationStage === 'resolve-location' &&
    error.creationOutcome === 'not-attempted' &&
    error.manifestPath === undefined &&
    error.code === undefined &&
    error.cause instanceof UntitledPlaceholderRecoveryLocationUnavailableError
  )
}

export async function failUntitledPlaceholderCreation(
  creation: {
    source?: FileHandle
    manifest?: FileHandle
    manifestPath?: string
    stage: UntitledPlaceholderCreationStage
    outcome: UntitledPlaceholderCreationOutcome
  },
  cause: unknown,
  ownerKey: string,
  revoked: ReadonlySet<string>
): Promise<never> {
  try {
    if (creation.manifest) {
      await creation.manifest.writeFile(`${JSON.stringify({ phase: 'create-failed' })}\n`, 'utf8')
      await creation.manifest.sync()
    }
  } finally {
    try {
      await creation.source?.close()
    } finally {
      await creation.manifest?.close()
    }
  }
  try {
    assertUntitledPlaceholderOwnerAvailable(ownerKey, revoked)
  } catch (error) {
    creation.stage = 'owner'
    cause = error
  }
  throw new UntitledPlaceholderRetentionUnavailableError(
    creation.manifestPath,
    cause,
    creation.stage,
    creation.outcome
  )
}
