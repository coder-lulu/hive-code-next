import { randomUUID, createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { TaskExecutionStartSchema } from '../../shared/task-execution/task-execution-command'
import { TaskOpaqueRef, TaskRefSchema } from '../../shared/task-execution/task-execution-primitives'
import { computeTaskExecutionFingerprint } from '../../shared/task-execution/task-execution-fingerprint'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-publication'
import type { LocalTaskGrant } from './local-task-authority'
import { HiveRuntimeAdapterBinding, type HiveRuntimeBinding } from './paperclip-adapter-contract'
import { createTaskManagedCopy } from './task-managed-copy'
import { refuseTaskExecution, TaskExecutionError } from './task-execution-error'
import { taskCodexResultInstructions } from './task-codex-evidence'
import type { TaskExecutionWorkspace } from './task-execution-record'

const Input = z.strictObject({
  paperclipCompanyId: TaskOpaqueRef,
  paperclipAgentId: TaskOpaqueRef,
  task: TaskRefSchema,
  workspaceSelector: z.string().min(1).max(512),
  input: z.string().min(1).max(48_000)
})
export type LocalTaskBindingInput = z.infer<typeof Input>
export type LocalTaskRuntimeOwner = Readonly<{
  runtimeRecordId: string
  ownershipEpoch: number
  accountId: string
}>
type Entry = { binding: HiveRuntimeBinding; grant: LocalTaskGrant; fingerprint: string }
const reference = (kind: string) => `${kind}:${randomUUID()}`
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** Only the authenticated Facade calls issue; an adapter/config cannot mint a grant. */
export class LocalTaskBindingIssuer {
  private readonly entries = new Map<string, Entry>()
  private readonly flights = new Map<
    string,
    { fingerprint: string; promise: Promise<HiveRuntimeBinding> }
  >()
  private readonly grants = new Map<string, LocalTaskGrant>()
  private closed = false
  issuedBindings() {
    return [...this.entries.values()].map((entry) => entry.binding)
  }
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
    const key = digest([input.paperclipCompanyId, input.task.runId])
    const fingerprint = digest(input)
    const previous = this.entries.get(key)
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        return Promise.reject(new TaskExecutionError('IDEMPOTENCY_CONFLICT'))
      }
      return this.resolveBinding(
        input.paperclipCompanyId,
        input.task.runId,
        this.options.operationCallerKey
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
    const owner = this.requireOwner()
    const assertOwner = () => {
      const current = this.requireOwner()
      if (
        current.account.accountId !== owner.account.accountId ||
        current.account.authorityId !== owner.account.authorityId ||
        current.account.sessionGeneration !== owner.account.sessionGeneration ||
        current.runtime.runtimeRecordId !== owner.runtime.runtimeRecordId ||
        current.runtime.ownershipEpoch !== owner.runtime.ownershipEpoch
      ) {
        return refuseTaskExecution('FORBIDDEN')
      }
    }
    await mkdir(join(this.options.directory, 'bindings'), { recursive: true, mode: 0o700 })
    assertOwner()
    // An unfinished/restarted preparation is never silently reminted as another execution.
    try {
      await writeFile(
        join(this.options.directory, 'bindings', `${key}.intent.json`),
        JSON.stringify({ fingerprint, input }),
        { flag: 'wx', mode: 0o600 }
      )
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
        return refuseTaskExecution('OUTCOME_UNKNOWN')
      }
      throw error
    }
    const source = await this.options.resolveSource(input.workspaceSelector)
    const copy = await createTaskManagedCopy({
      source: source.path,
      directory: join(this.options.directory, 'workspaces'),
      assertCurrent: () => {
        assertOwner()
        source.assertCurrent()
      }
    })
    assertOwner()
    const registered = await this.options.registerWorkspace(copy.executionPath)
    const assertCurrent = () => {
      assertOwner()
      source.assertCurrent()
      copy.assertCurrent()
      registered.assertCurrent()
    }
    assertCurrent()
    const workspace: TaskExecutionWorkspace = {
      hostId: 'local',
      workspaceId: registered.workspaceId,
      canonicalPath: copy.canonicalPath,
      executionPath: copy.executionPath,
      isolation: 'managed_copy'
    }
    const command = TaskExecutionStartSchema.parse({
      protocolVersion: 1,
      kind: 'execution.start',
      runtimeRecordId: owner.runtime.runtimeRecordId,
      ownershipEpoch: owner.runtime.ownershipEpoch,
      executionId: reference('execution'),
      executionEpoch: 1,
      task: input.task,
      operationId: `${this.now()}-${randomUUID().replaceAll('-', '')}`,
      idempotencyKey: reference('start'),
      agent: 'hivecode',
      profileId: 'codex',
      profileRevision: 'codex:1',
      policyRevision: 'personal-preview:1',
      ownerScope: {
        kind: 'personalTenant',
        tenantRef: `account:${digest(owner.account.accountId)}`
      },
      executionAccountRef: `account:${digest(owner.account.accountId)}`,
      billingSubjectRef: 'billing:external-codex',
      workspaceRef: `workspace:${digest(source.path)}`,
      workspaceExecutionClaimRef: reference('claim'),
      isolationPolicyRef: 'managed-copy:1',
      writeFence: 1,
      executionPolicy: {
        trustMode: 'trusted_personal_preview',
        executionPolicyRef: 'personal-preview',
        executionPolicyRevision: '1'
      },
      inputRef: `input:${digest(input.input)}`,
      authorizationRef: reference('authorization'),
      authorizationRevision: '1',
      expiresAt: new Date(
        Math.min(owner.account.sessionExpiresAt, this.now() + 60_000)
      ).toISOString(),
      requiredCapabilities: []
    })
    const commandFingerprint = computeTaskExecutionFingerprint(
      command,
      this.options.operationCallerKey
    )
    const binding = HiveRuntimeAdapterBinding.parse({
      bindingRef: reference('binding'),
      paperclipCompanyId: input.paperclipCompanyId,
      paperclipAgentId: input.paperclipAgentId,
      command,
      commandFingerprint
    })
    const grant: LocalTaskGrant = {
      command,
      operationCallerKey: this.options.operationCallerKey,
      accountId: owner.account.accountId,
      authorityId: owner.account.authorityId,
      sessionGeneration: owner.account.sessionGeneration,
      validUntil: owner.account.sessionExpiresAt,
      actions: ['start', 'observe', 'reconcile', 'cancel'],
      workspace,
      input: input.input + taskCodexResultInstructions({ command, commandFingerprint }),
      assertCurrent
    }
    await writeFile(
      join(this.options.directory, 'bindings', `${key}.json`),
      JSON.stringify({
        binding,
        workspace,
        accountId: grant.accountId,
        authorityId: grant.authorityId,
        sessionGeneration: grant.sessionGeneration,
        fingerprint
      }),
      { flag: 'wx', mode: 0o600 }
    )
    assertCurrent()
    this.grants.set(command.authorizationRef, grant)
    this.entries.set(key, { binding, grant, fingerprint })
    return structuredClone(binding)
  }

  async resolveBinding(companyId: string, runId: string, operationCallerKey: string) {
    const entry = this.entries.get(digest([companyId, runId]))
    if (!entry || operationCallerKey !== this.options.operationCallerKey) {
      return refuseTaskExecution('FORBIDDEN')
    }
    entry.grant.assertCurrent()
    const owner = this.requireOwner()
    // Renew only authorization lifetime; the committed execution fingerprint never changes.
    entry.grant.validUntil = owner.account.sessionExpiresAt
    return {
      ...structuredClone(entry.binding),
      command: {
        ...entry.binding.command,
        expiresAt: new Date(
          Math.min(owner.account.sessionExpiresAt, this.now() + 60_000)
        ).toISOString()
      }
    }
  }

  async close() {
    this.closed = true
    this.grants.clear()
    await Promise.allSettled([...this.flights.values()].map((entry) => entry.promise))
  }
}
