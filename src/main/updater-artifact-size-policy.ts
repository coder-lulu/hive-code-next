export const MAX_UPDATER_ARTIFACT_BYTES = 2 * 1024 * 1024 * 1024

export function isBoundedUpdaterArtifactSize(size: number): boolean {
  return Number.isSafeInteger(size) && size > 0 && size <= MAX_UPDATER_ARTIFACT_BYTES
}
