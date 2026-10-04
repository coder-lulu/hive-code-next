import { createHash } from 'node:crypto'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-publication'
import type { LocalTaskGrant } from './local-task-authority'
import {
  HiveRuntimeBindingPurposeSchema,
  type HiveRuntimeBinding,
  type HiveRuntimeBindingPurpose
} from './paperclip-adapter-contract'
import { createRecoveredLocalTaskGrant } from './local-task-recovery-grant'
import { prepareLocalTaskBinding } from './local-task-binding-preparation'
import { pruneTaskBindings, type BindingEntry as Entry } from './local-task-binding-retention'
import { refuseTaskExecution, TaskExecutionError } from './task-execution-error'
import { taskCodexResultInstructions } from './task-codex-evidence'
import type { TaskExecutionRecord, TaskExecutionWorkspace } from './task-execution-record'
import { computeAgentLaunchFingerprint } from '../../shared/agent-launch-operation'
import { taskAgentLaunchParams } from './task-agent-launch-params'
import {
  LocalTaskBindingInputSchema as Input,
  localTaskBindingKey,
  readLocalTaskBinding,
  type LocalTaskBindingInput
} from './local-task-binding-file'

export type { LocalTaskBindingInput } from './local-task-binding-file'
export type LocalTaskRuntimeOwner = Readonly<{
  runtimeRecordId: string
  ownershipEpoch: number
  accountId: string
}>
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** Only the authenticated Facade calls issue; an adapter/config cannot mint a grant. */
export class LocalTaskBindingIssuer {
  private readonly entries = new Map<string, Entry>()
  private readonly flights = new Map<
    string,
    { fingerprint: string; promise: Promise<HiveRuntimeBinding> }
  >()
  private readonly grants = new Map<string, LocalTaskGrant>()
  private readonly recoveryFlights = new Map<string, Promise<Entry>>()
  private readonly executionEntries = new Map<string, Entry>()
  private closed = false
  constructor(
    private readonly options: {
      directory: string
      operationCallerKey: string
      currentAccount: () => HiveRuntimeCloudAuthorization | null
      currentRuntime: () => LocalTaskRuntimeOwner | null
      resolveSource: (selector: string) => Promise<{ path: string; assertCurrent: () => void }>
      registerWorkspace: (
        path: string
      ) => Promise<{ workspaceId: string; assertCurrent: () => void }>
      readExecution(command: TaskExecutionRecord['command']): TaskExecutionRecord | null
      restoreWorkspace(workspace: TaskExecutionWorkspace): Promise<{ assertCurrent(): void }>
      assertCurrent?: () => void
      now?: () => number
    }
  ) {}

  resolveGrant = (ref: string) => (this.closed ? null : (this.grants.get(ref) ?? null))

  private requireOwner() {
    this.options.assertCurrent?.()
    const account = this.options.currentAccount()
    const runtime = this.options.currentRuntime()
    if (
      this.closed ||
      !account ||
      !runtime ||
      account.sessionExpiresAt <= this.now() ||
      runtime.accountId !== account.accountId
    ) {
      return refuseTaskExecution('FORBIDDEN')
    }
    return { account, runtime }
  }
  private now() {
    return (this.options.now ?? Date.now)()
  }

  issue(raw: LocalTaskBindingInput): Promise<HiveRuntimeBinding> {
    const input = Input.parse(raw)
    this.requireOwner()
    this.pruneSettledBindings()
    const key = localTaskBindingKey(input.paperclipCompanyId, input.task.runId)
    const fingerprint = digest(input)
    const previous = this.entries.get(key)
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        return Promise.reject(new TaskExecutionError('IDEMPOTENCY_CONFLICT'))
      }
      return this.resolveBinding(
        input.paperclipCompanyId,
        input.task.runId,
        this.options.operationCallerKey,
        'execute'
      )
    }
    const pending = this.flights.get(key)
    if (pending) {
      if (pending.fingerprint !== fingerprint) {
        return Promise.reject(new TaskExecutionError('IDEMPOTENCY_CONFLICT'))
      }
      return pending.promise
    }
    if (this.entries.size + this.flights.size >= 512) {
      return Promise.reject(new TaskExecutionError('CAPACITY_EXCEEDED'))
    }
    const promise = this.prepare(input, key, fingerprint).finally(() => this.flights.delete(key))
    this.flights.set(key, { fingerprint, promise })
    return promise
  }

  private async prepare(input: LocalTaskBindingInput, key: string, fingerprint: string) {
    const entry = await prepareLocalTaskBinding(
      { ...this.options, requireOwner: () => this.requireOwner(), now: () => this.now() },
      input,
      key,
      fingerprint
    )
    entry.grant.assertCurrent()
    this.grants.set(entry.grant.command.authorizationRef, entry.grant)
    this.entries.set(key, entry)
    this.executionEntries.set(entry.binding.commandFingerprint, entry)
    return structuredClone(entry.binding)
  }

  async resolveBinding(
    companyId: string,
    runId: string,
    operationCallerKey: string,
    purpose: HiveRuntimeBindingPurpose
  ) {
    HiveRuntimeBindingPurposeSchema.parse(purpose)
    const key = localTaskBindingKey(companyId, runId)
    if (operationCallerKey !== this.options.operationCallerKey) {
      return refuseTaskExecution('FORBIDDEN')
    }
    const owner = this.requireOwner()
    let entry = this.entries.get(key)
    if (purpose === 'execute') {
      if (!entry?.grant?.actions.includes('start')) {
        return refuseTaskExecution('FORBIDDEN')
      }
    } else {
      entry ??= await this.restoreEntry(key)
      let replace = !entry.grant || entry.grant.actions.includes('start')
      if (!replace) {
        try {
          entry.grant!.assertCurrent()
        } catch {
          replace = true
        }
      }
      if (replace) {
        const grant = createRecoveredLocalTaskGrant(
          entry,
          owner,
          () => this.requireOwner(),
          operationCallerKey
        )
        // Registry removal fences previously captured admissions at their final spawn guard.
        if (entry.grant) {
          this.grants.delete(entry.grant.command.authorizationRef)
        }
        entry.grant = grant
        this.grants.set(grant.command.authorizationRef, grant)
      }
    }
    if (!entry?.grant) {
      return refuseTaskExecution('FORBIDDEN')
    }
    entry.grant.assertCurrent()
    // Renew only authorization lifetime; the committed execution fingerprint never changes.
    const expiresAt = Math.min(owner.account.sessionExpiresAt, this.now() + 60_000)
    entry.grant.validUntil = expiresAt
    return {
      ...structuredClone(entry.binding),
      command: {
        ...entry.grant.command,
        expiresAt: new Date(expiresAt).toISOString()
      }
    }
  }

  async restoreBindings(records: readonly TaskExecutionRecord[]) {
    const keys = [
      ...new Set(
        records
          .filter(
            (record) =>
              record.operationCallerKey === this.options.operationCallerKey && !record.result
          )
          .map((record) =>
            localTaskBindingKey(record.command.task.spaceId, record.command.task.runId)
          )
      )
    ]
    let restored = 0
    for (const key of keys) {
      try {
        if (!this.entries.has(key)) {
          await this.restoreEntry(key)
        }
        restored++
      } catch {
        /* Unproven bindings do not authorize execution recovery. */
      }
    }
    return { restored, unavailable: keys.length - restored }
  }

  private pruneSettledBindings() {
    pruneTaskBindings(
      this.entries,
      this.grants,
      this.executionEntries,
      this.options.readExecution,
      this.now()
    )
  }

  private restoreEntry(key: string): Promise<Entry> {
    const flight = this.recoveryFlights.get(key)
    if (flight) {
      return flight
    }
    const recovering = this.loadRecoveryEntry(key).finally(() => this.recoveryFlights.delete(key))
    this.recoveryFlights.set(key, recovering)
    return recovering
  }

  private async loadRecoveryEntry(key: string): Promise<Entry> {
    this.options.assertCurrent?.()
    if (this.closed) {
      return refuseTaskExecution('SERVICE_UNAVAILABLE')
    }
    const stored = await readLocalTaskBinding({
      directory: this.options.directory,
      key,
      operationCallerKey: this.options.operationCallerKey,
      readExecution: this.options.readExecution
    })
    const proof = await this.options.restoreWorkspace(stored.workspace)
    const assertWorkspaceCurrent = () => {
      this.options.assertCurrent?.()
      stored.assertCurrent()
      proof.assertCurrent()
    }
    const assertExecutionCurrent = () => {
      const current = this.requireOwner()
      if (
        current.account.accountId !== stored.accountId ||
        current.account.authorityId !== stored.authorityId ||
        current.account.sessionGeneration !== stored.sessionGeneration ||
        current.runtime.runtimeRecordId !== stored.binding.command.runtimeRecordId ||
        current.runtime.ownershipEpoch !== stored.binding.command.ownershipEpoch
      ) {
        return refuseTaskExecution('FORBIDDEN')
      }
      assertWorkspaceCurrent()
    }
    assertWorkspaceCurrent()
    if (this.closed) {
      return refuseTaskExecution('SERVICE_UNAVAILABLE')
    }
    this.pruneSettledBindings()
    if (!this.entries.has(key) && this.entries.size + this.flights.size >= 512) {
      return refuseTaskExecution('CAPACITY_EXCEEDED')
    }
    const previous = this.entries.get(key)
    if (previous?.grant) {
      this.grants.delete(previous.grant.command.authorizationRef)
    }
    const entry: Entry = {
      binding: stored.binding,
      grant: null,
      fingerprint: stored.fingerprint,
      assertExecutionCurrent,
      assertWorkspaceCurrent,
      accountId: stored.accountId,
      input: stored.input.input + taskCodexResultInstructions(stored.binding),
      workspace: stored.workspace
    }
    this.entries.set(key, entry)
    this.executionEntries.set(entry.binding.commandFingerprint, entry)
    return entry
  }

  assertExecutionCurrent(record: TaskExecutionRecord): void {
    const entry = this.entryForRecord(record)
    if (!entry) {
      return refuseTaskExecution('FORBIDDEN')
    }
    entry.assertExecutionCurrent()
  }

  launchFingerprint(record: TaskExecutionRecord) {
    const entry = this.entryForRecord(record)
    if (!entry) {
      return null
    }
    entry.assertWorkspaceCurrent()
    return computeAgentLaunchFingerprint(taskAgentLaunchParams(record, entry.input, 'codex'))
  }

  private entryForRecord(record: TaskExecutionRecord) {
    return record.operationCallerKey === this.options.operationCallerKey
      ? (this.executionEntries.get(record.commandFingerprint) ?? null)
      : null
  }

  async close() {
    this.closed = true
    this.grants.clear()
    const preparations = [...this.flights.values()].map((entry) => entry.promise)
    await Promise.allSettled([...preparations, ...this.recoveryFlights.values()])
  }
}
