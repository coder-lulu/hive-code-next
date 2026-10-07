import type { JournalHostDatabase } from '../native-chat/agent-session-journal/journal-host-database'
import { agentSessionRefusalError } from '../../shared/agent-session-wire-refusals'
import type { AgentSessionRecordStore } from './agent-session-record-store'
import { loadAgentSessionStoreRows } from './agent-session-record-rows'
import { AgentSessionStoreTransactions } from './agent-session-store-transactions'

type LiveHostStore = {
  store: AgentSessionRecordStore
  transactions: AgentSessionStoreTransactions
}
const openedStores = new WeakMap<JournalHostDatabase, Map<string, LiveHostStore>>()

/** The same complete store while its exact host database lives; restart creates fresh private facts. */
export function openLiveAgentSessionRecordStore(
  args: { journalDatabase: JournalHostDatabase; hostId: string },
  create: (transactions: AgentSessionStoreTransactions, hostId: string) => AgentSessionRecordStore
): AgentSessionRecordStore {
  let hosts = openedStores.get(args.journalDatabase)
  const existing = hosts?.get(args.hostId)
  if (existing) {
    existing.transactions.refreshCommittedState()
    return existing.store
  }
  if (args.journalDatabase.db.isTransaction) {
    throw agentSessionRefusalError('agent_session_ownership_unknown', {
      reason: 'replaySuperseded'
    })
  }
  const loaded = loadAgentSessionStoreRows(args.journalDatabase.db, args.hostId)
  const transactions = new AgentSessionStoreTransactions(args.journalDatabase, loaded)
  const store = create(transactions, args.hostId)
  hosts ??= new Map()
  hosts.set(args.hostId, { store, transactions })
  openedStores.set(args.journalDatabase, hosts)
  return store
}
