/** A stable, single-link regular file for tests that fake reads beneath the real safe opener. */
export const regularTranscriptStats = {
  dev: 1,
  ino: 1,
  nlink: 1,
  isFile: () => true,
  isSymbolicLink: () => false
}

export function withRegularTranscriptStat<T extends object>(handle: T) {
  return Object.assign(handle, { stat: async () => regularTranscriptStats })
}
