import type { FileHandle } from 'node:fs/promises'
import { UntitledPlaceholderLeaseCloseError } from './untitled-placeholder-retention-types'
import type { UntitledPlaceholderOriginLease } from './untitled-placeholder-retention-types'

/** Keep both actual descriptor close attempts and every error; the caller owns the lease map. */
export async function closeUntitledPlaceholderLease(
  lease: UntitledPlaceholderOriginLease,
  beforeClose?: (source: FileHandle) => void | Promise<void>
): Promise<void> {
  try {
    await beforeClose?.(lease.source)
    const results = await Promise.allSettled(
      [lease.source, lease.manifest].map((handle) => Promise.resolve().then(() => handle.close()))
    )
    const errors = results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason)
    if (errors.length === 1) {
      throw errors[0]
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Untitled placeholder descriptor closes failed')
    }
  } catch (error) {
    throw new UntitledPlaceholderLeaseCloseError(lease.recovery, error)
  }
}
