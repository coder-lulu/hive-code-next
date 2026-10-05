import type { OpenFile } from '../types/open-file'
import { getDiskBaselineSignature } from '@/components/editor/diff-content-signature'

const EMPTY_DISK_SIGNATURE = getDiskBaselineSignature('')

export type UntitledFileCleanupResult = {
  status: 'preserved'
  reason: 'atomic-delete-unavailable'
  filePath: string
}

export function getUntitledFileCleanupResult(
  file: OpenFile | undefined,
  hasDraft: boolean
): UntitledFileCleanupResult | undefined {
  if (
    file?.isUntitled === true &&
    !file.isDirty &&
    !hasDraft &&
    file.deleteUntouchedOnClose !== false &&
    (file.lastKnownDiskSignature === undefined ||
      file.lastKnownDiskSignature === EMPTY_DISK_SIGNATURE)
  ) {
    // No provider can atomically delete the same still-empty object; stat followed by unlink races writers.
    return { status: 'preserved', reason: 'atomic-delete-unavailable', filePath: file.filePath }
  }
  return undefined
}
