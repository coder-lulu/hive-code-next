import type { HiveRuntimeBinding } from './paperclip-adapter-contract'
import type { LocalTaskGrant } from './local-task-authority'
import type { TaskExecutionRecord, TaskExecutionWorkspace } from './task-execution-record'

export type BindingEntry = {
  binding: HiveRuntimeBinding
  grant: LocalTaskGrant | null
  fingerprint: string
  assertExecutionCurrent(): void
  assertWorkspaceCurrent(): void
  accountId: string
  input: string
  workspace: TaskExecutionWorkspace
}

/** Terminal cache eviction leaves durable bindings and active workspace claims intact. */
export function pruneTaskBindings(
  entries: Map<string, BindingEntry>,
  grants: Map<string, LocalTaskGrant>,
  executionEntries: Map<string, BindingEntry>,
  readExecution: (command: TaskExecutionRecord['command']) => TaskExecutionRecord | null,
  now: number
) {
  for (const [key, entry] of entries) {
    if (
      (!entry.grant || entry.grant.validUntil <= now) &&
      readExecution(entry.binding.command)?.result
    ) {
      if (entry.grant) {
        grants.delete(entry.grant.command.authorizationRef)
      }
      entries.delete(key)
      executionEntries.delete(entry.binding.commandFingerprint)
    }
  }
}
