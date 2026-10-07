import type { TaskExecutionRecord } from './task-execution-record'

/** Includes retained terminal associations; losing a session field cannot make it personal. */
export function hasTaskSessionBinding(
  tasks: ReadonlyMap<string, TaskExecutionRecord> | undefined,
  sessionId: string
): boolean {
  for (const task of tasks?.values() ?? []) {
    if (
      task.structuredBinding?.sessionId === sessionId ||
      (task.launch?.outcome.kind === 'structured' && task.launch.outcome.sessionId === sessionId)
    ) {
      return true
    }
  }
  return false
}
