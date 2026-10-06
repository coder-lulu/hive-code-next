import type { TaskExecutionRecord } from './task-execution-record'

/** A missing primary fact cannot erase effects the original store already observed. */
export function taskExecutionEvidenceRegressed(
  previous: ReadonlyMap<string, TaskExecutionRecord> | undefined,
  current: ReadonlyMap<string, TaskExecutionRecord> | undefined
): boolean {
  for (const [key, before] of previous ?? []) {
    if (before.result) {
      continue
    }
    const after = current?.get(key)
    if (
      (before.launch && !after?.launch) ||
      (Object.hasOwn(before, 'structuredBinding') &&
        !Object.hasOwn(after ?? {}, 'structuredBinding')) ||
      (Object.hasOwn(before, 'dockerIdentity') && !Object.hasOwn(after ?? {}, 'dockerIdentity')) ||
      (before.modelDispatchAttempts !== undefined &&
        (after?.modelDispatchAttempts === undefined ||
          after.modelDispatchAttempts < before.modelDispatchAttempts))
    ) {
      return true
    }
  }
  return false
}
