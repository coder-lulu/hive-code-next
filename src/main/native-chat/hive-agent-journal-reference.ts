import type { HiveAgentSessionEntry } from '../../shared/hive-agent-session-entry'
import type { HiveAgentHostDependencies } from './hive-agent-session-dependencies'

export async function readHiveAgentJournal(
  deps: HiveAgentHostDependencies,
  entry: HiveAgentSessionEntry
) {
  const journal = await deps.journalFor(entry)
  const expected =
    entry.aggregate.binding?.providerKind === 'managed-pi'
      ? entry.aggregate.session.sessionId
      : entry.aggregate.binding?.runtimeRecordRef
  if (!expected || journal.snapshot().sessionId !== expected) {
    throw new Error('hive_agent_forbidden')
  }
  return journal
}
