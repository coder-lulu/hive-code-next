import type { AgentSessionOperationRow } from '../../shared/agent-session-operation-ledger'
import { AGENT_SESSION_OPERATION_FUTURE_SKEW_MS } from '../../shared/agent-session-host-authority'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import { raiseAgentSessionFencesAfterBackupRecovery } from './agent-session-backup-recovery-fence'
import {
  AGENT_SESSION_STORE_SCHEMA_VERSION,
  agentSessionStoreRevision,
  loadAgentSessionStore,
  saveAgentSessionStore,
  type AgentSessionStoreState,
  type LoadedAgentSessionStore
} from './agent-session-record-store-file'
import { withFileTransactionLock } from '../file-transaction-lock'
import type { TaskExecutionRecord } from '../tasks/task-execution-record'
import { taskExecutionEvidenceRegressed } from '../tasks/task-execution-evidence-regression'

function markLoadedLeasesUnreconciled(state: AgentSessionStoreState): void {
  for (const [sessionId, record] of state.records) {
    const lease = { ...record.lease, unreconciled: true }
    // Settlement now derives from the retained exit evidence and journal turn. An older
    // build's retry latch must not survive a new acquisition or be replayed on downgrade.
    delete lease.settlementRetryRequired
    delete lease.settlementRetryId
    state.records.set(sessionId, { ...record, lease })
  }
}

function mapEntriesMatch<K, V>(left: ReadonlyMap<K, V>, right: ReadonlyMap<K, V>): boolean {
  if (left.size !== right.size) {
    return false
  }
  for (const [key, value] of left) {
    if (right.get(key) !== value) {
      return false
    }
  }
  return true
}

function agentSessionStoreStateChanged(
  state: AgentSessionStoreState,
  records: ReadonlyMap<string, AgentSessionRecord>,
  operations: ReadonlyMap<string, AgentSessionOperationRow>,
  retiredClaimKeys: AgentSessionStoreState['retiredClaimKeys'],
  unreadableRecords: AgentSessionStoreState['unreadableRecords'],
  sessionTabs: AgentSessionStoreState['sessionTabs']
): boolean {
  return (
    !mapEntriesMatch(state.records, records) ||
    !mapEntriesMatch(state.operations, operations) ||
    !mapEntriesMatch(state.unreadableRecords, unreadableRecords) ||
    (state.sessionTabs && sessionTabs
      ? !state.sessionTabs.equals(sessionTabs)
      : state.sessionTabs !== sessionTabs) ||
    state.retiredClaimKeys.length !== retiredClaimKeys.length ||
    state.retiredClaimKeys.some((entry, index) => entry !== retiredClaimKeys[index])
  )
}

export class AgentSessionStoreTransactionQueue {
  private queue: Promise<unknown> = Promise.resolve()
  private diskRecoveredFromBackup: boolean
  private readSnapshot: AgentSessionStoreState | undefined

  constructor(
    private readonly filePath: string,
    readonly hostId: string,
    readonly readOnly: boolean,
    readonly recoveredFromBackup: boolean,
    private diskStoreFound: boolean,
    public state: AgentSessionStoreState,
    private diskRevision: string,
    private needsRewrite: boolean
  ) {
    this.diskRecoveredFromBackup = recoveredFromBackup
  }

  /** Public readers share the rollback version until the durable write succeeds. */
  get readState(): AgentSessionStoreState {
    return this.readSnapshot ?? this.state
  }

  static fromLoadedStore(
    filePath: string,
    hostId: string,
    loaded: LoadedAgentSessionStore,
    diskRevision: string
  ): AgentSessionStoreTransactionQueue {
    return new AgentSessionStoreTransactionQueue(
      filePath,
      hostId,
      loaded.readOnly,
      loaded.recoveredFromBackup,
      loaded.storeFound,
      loaded.state,
      diskRevision,
      loaded.needsRewrite
    )
  }

  readTaskExecution(key: string): TaskExecutionRecord | null {
    return structuredClone(this.readState.taskExecutions?.get(key) ?? null)
  }

  readActiveTaskExecutions(): TaskExecutionRecord[] {
    const records = this.readState.taskExecutions
    return structuredClone([...(records?.values() ?? [])].filter((record) => !record.result))
  }

  transact<T>(apply: () => T): Promise<T> {
    const run = this.queue.then(() =>
      withFileTransactionLock(this.filePath, async () => {
        if (this.readOnly) {
          throw new Error('agent_session_legacy_required')
        }
        await this.refreshExternallyChangedState()
        await this.persistTaskRecoveryFence()
        const records = new Map(this.state.records)
        const hiveSessions = new Map(this.state.hiveSessions)
        const hiveRecoveryFenceAt = this.state.hiveRecoveryFenceAt
        const taskExecutions = new Map(this.state.taskExecutions)
        const taskRecoveryBlocked = this.state.taskRecoveryBlocked
        const operations = new Map(this.state.operations)
        const retiredClaimKeys = [...this.state.retiredClaimKeys]
        const unreadableRecords = new Map(this.state.unreadableRecords)
        const sessionTabs = this.state.sessionTabs?.clone() ?? null
        this.readSnapshot = {
          ...this.state,
          records,
          hiveSessions,
          hiveRecoveryFenceAt,
          taskExecutions,
          taskRecoveryBlocked,
          operations,
          retiredClaimKeys,
          unreadableRecords,
          sessionTabs
        }
        try {
          // The lost commit may have granted a higher fence than the backup records show. Rather
          // than refuse forever, raise every recovered fence clear of anything that commit could
          // have minted, then continue in the same transaction.
          const recovering = this.diskRecoveredFromBackup
          if (recovering) {
            // A backup may omit the last admitted writer; P2 must prove its absence before dispatch.
            this.state.taskRecoveryBlocked = true
            raiseAgentSessionFencesAfterBackupRecovery(this.state)
            this.state.hiveRecoveryFenceAt = Math.max(
              this.state.hiveRecoveryFenceAt ?? 0,
              Date.now() + AGENT_SESSION_OPERATION_FUTURE_SKEW_MS
            )
          }
          const result = apply()
          if (
            !recovering &&
            !this.needsRewrite &&
            mapEntriesMatch(this.state.hiveSessions ?? new Map(), hiveSessions) &&
            mapEntriesMatch(this.state.taskExecutions ?? new Map(), taskExecutions) &&
            this.state.taskRecoveryBlocked === taskRecoveryBlocked &&
            !agentSessionStoreStateChanged(
              this.state,
              records,
              operations,
              retiredClaimKeys,
              unreadableRecords,
              sessionTabs
            )
          ) {
            return result
          }
          await saveAgentSessionStore(this.filePath, this.state, {
            primaryStatus: this.diskStoreFound && !recovering ? 'validated' : 'unusable-or-absent'
          })
          this.state.schemaVersion = AGENT_SESSION_STORE_SCHEMA_VERSION
          this.diskRevision = agentSessionStoreRevision(this.state)
          this.diskRecoveredFromBackup = false
          this.diskStoreFound = true
          this.needsRewrite = false
          return result
        } catch (error) {
          this.state.records = records
          this.state.hiveSessions = hiveSessions
          this.state.hiveRecoveryFenceAt = hiveRecoveryFenceAt
          this.state.taskExecutions = taskExecutions
          this.state.taskRecoveryBlocked = taskRecoveryBlocked
          this.state.operations = operations
          this.state.retiredClaimKeys = retiredClaimKeys
          this.state.unreadableRecords = unreadableRecords
          this.state.sessionTabs = sessionTabs
          throw error
        } finally {
          this.readSnapshot = undefined
        }
      })
    )
    this.queue = run.catch(() => {})
    return run
  }

  persistLoadedRewrite(): Promise<void> {
    return this.transact(() => undefined)
  }

  private async persistTaskRecoveryFence(): Promise<void> {
    if (!this.needsRewrite || !this.state.taskRecoveryBlocked || this.diskRecoveredFromBackup) {
      return
    }
    // A refused business callback must not erase the host's observed loss of execution evidence.
    await saveAgentSessionStore(this.filePath, this.state, {
      primaryStatus: this.diskStoreFound ? 'validated' : 'unusable-or-absent'
    })
    this.state.schemaVersion = AGENT_SESSION_STORE_SCHEMA_VERSION
    this.diskRevision = agentSessionStoreRevision(this.state)
    this.diskStoreFound = true
    this.needsRewrite = false
  }

  private async refreshExternallyChangedState(): Promise<void> {
    const loaded = await loadAgentSessionStore(this.filePath, this.hostId)
    if (this.diskStoreFound && !loaded.storeFound) {
      throw new Error('agent_session_store_corrupt')
    }
    this.diskStoreFound ||= loaded.storeFound
    const diskRevision = agentSessionStoreRevision(loaded.state)
    this.diskRecoveredFromBackup = loaded.recoveredFromBackup
    if (diskRevision === this.diskRevision) {
      this.needsRewrite ||= loaded.needsRewrite
      return
    }
    if (loaded.readOnly) {
      throw new Error('agent_session_legacy_required')
    }
    const lostTaskEffects = taskExecutionEvidenceRegressed(
      this.state.taskExecutions,
      loaded.state.taskExecutions
    )
    const retainedTaskFence =
      this.state.taskRecoveryBlocked === true && !loaded.state.taskRecoveryBlocked
    if (lostTaskEffects || this.state.taskRecoveryBlocked) {
      loaded.state.taskRecoveryBlocked = true
    }
    markLoadedLeasesUnreconciled(loaded.state)
    this.state = loaded.state
    this.diskRevision = diskRevision
    this.needsRewrite = loaded.needsRewrite || lostTaskEffects || retainedTaskFence
  }
}

export function markAgentSessionStoreLeasesUnreconciled(state: AgentSessionStoreState): void {
  markLoadedLeasesUnreconciled(state)
}
