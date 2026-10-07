import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HiveRuntimeAdapterBinding } from './paperclip-adapter-contract'
import { TaskExecutionResultSchema } from '../../shared/task-execution/task-execution-receipts'
import { workflowPrepareFixture } from './local-task-workflow-prepare.test-fixture'

const fixtures: Awaited<ReturnType<typeof workflowPrepareFixture>>[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.close()))
  vi.restoreAllMocks()
})
async function fixture() {
  const f = await workflowPrepareFixture(
    resolve('logs/paperclip-development/p3/task-native-acceptance-contract/start-race-writer/f')
  )
  fixtures.push(f)
  return f
}

describe('exact locally issued queued workflow binding', () => {
  it('renews only local authorization while retaining the existing immutable queued binding', async () => {
    const f = await fixture()
    await f.client.prepareCaseRun(f.refs)
    f.task.binding!.command.expiresAt = new Date(Date.now() - 1).toISOString()
    const committed = structuredClone(f.task)
    await expect(f.client.prepareCaseRun(f.refs)).resolves.toEqual(f.refs)
    expect(f.task).toEqual(committed)
    expect(f.bindingCommit).toHaveBeenCalledOnce()
    expect(f.unavailable).not.toHaveBeenCalled()
  })
  it.each([
    'bindingRef',
    'executionId',
    'ownershipEpoch',
    'writeFence',
    'authorizationRef',
    'profileRevision',
    'claim',
    'fingerprint',
    'deadline',
    'context',
    'attempt',
    'input',
    'workspace',
    'employee',
    'owner',
    'revision'
  ] as const)('refuses a schema-valid changed binding %s', async (field) => {
    const f = await fixture()
    await f.client.prepareCaseRun(f.refs)
    const binding = structuredClone(f.task.binding!)
    const command = binding.command
    if (field === 'bindingRef') {
      binding.bindingRef = 'binding:foreign'
    }
    if (field === 'executionId') {
      command.executionId = 'execution:foreign'
    }
    if (field === 'ownershipEpoch') {
      command.ownershipEpoch++
    }
    if (field === 'writeFence') {
      command.writeFence++
    }
    if (field === 'authorizationRef') {
      command.authorizationRef = 'authorization:foreign'
    }
    if (field === 'profileRevision') {
      command.profileRevision = 'codex:foreign'
    }
    if (field === 'claim') {
      command.workspaceExecutionClaimRef = 'claim:foreign'
    }
    if (field === 'fingerprint') {
      binding.commandFingerprint = 'f'.repeat(64)
    }
    if (field === 'deadline') {
      command.executionDeadlineAt = new Date(Date.now() + 240_000).toISOString()
    }
    if (field === 'context') {
      command.workflowContext!.employeeRef = randomUUID()
    }
    if (field === 'attempt') {
      command.task.attempt++
    }
    if (field === 'input') {
      command.inputRef = 'input:foreign'
    }
    if (field === 'workspace') {
      command.workspaceRef = 'workspace:foreign'
    }
    if (field === 'employee') {
      binding.paperclipAgentId = randomUUID()
    }
    if (field === 'owner') {
      command.ownerScope = { kind: 'personalTenant', tenantRef: 'account:foreign' }
    }
    if (field === 'revision') {
      command.task.taskRevision = '2'
    }
    f.task.binding = HiveRuntimeAdapterBinding.parse(binding)
    const changed = structuredClone(f.task)
    await expect(f.client.prepareCaseRun(f.refs)).rejects.toThrow('REVISION_CONFLICT')
    expect(f.task).toEqual(changed)
    expect(f.bindingWrite).toHaveBeenCalledOnce()
    expect(f.bindingCommit).toHaveBeenCalledOnce()
    expect(f.unavailable).not.toHaveBeenCalled()
  })
  it.each([
    'caseRevision',
    'taskRevision',
    'stageRevision',
    'status',
    'foreignCheckout',
    'missingCheckout',
    'missingLock',
    'unknown',
    'running',
    'cancelled',
    'result',
    'driver',
    'workspace',
    'personal',
    'stage',
    'deadline'
  ] as const)('refuses changed bound execution state %s before another issue', async (field) => {
    const f = await fixture()
    await f.client.prepareCaseRun(f.refs)
    if (field === 'caseRevision') {
      f.view.revision++
    }
    if (field === 'taskRevision') {
      f.task.status_version++
    }
    if (field === 'stageRevision') {
      f.view.stageTasks[0].taskRevision++
    }
    if (field === 'status') {
      f.task.status = 'blocked'
    }
    if (field === 'foreignCheckout') {
      Object.assign(f.task, { checkout_run_id: randomUUID() })
    }
    if (field === 'missingCheckout') {
      f.task.checkout_run_id = null
    }
    if (field === 'missingLock') {
      f.task.execution_locked_at = null
    }
    if (field === 'unknown') {
      Object.assign(f.task, { execution_stage: 'outcome_unknown' })
    }
    if (field === 'running') {
      f.task.run_status = 'running'
    }
    if (field === 'cancelled') {
      f.task.cancel_requested = true
    }
    if (field === 'result') {
      const command = f.task.binding!.command,
        recordedAt = new Date().toISOString()
      Object.assign(f.task, {
        result_receipt: TaskExecutionResultSchema.parse({
          protocolVersion: 1,
          kind: 'execution.result',
          status: 'cancelled',
          runtimeRecordId: command.runtimeRecordId,
          ownershipEpoch: command.ownershipEpoch,
          executionId: command.executionId,
          executionEpoch: command.executionEpoch,
          commandFingerprint: f.task.binding!.commandFingerprint,
          recordedAt,
          receiptId: 'receipt:unit',
          outcomeRef: 'outcome:unit',
          artifactRefs: [],
          usageFactRefs: [],
          stopProof: {
            proofRef: 'stop:unit',
            evidenceKind: 'stopped',
            managedToolsSettled: true,
            writersFenced: true,
            recordedAt
          }
        })
      })
    }
    if (field === 'driver') {
      f.task.driver_kind = 'foreign'
    }
    if (field === 'workspace') {
      f.task.run_scope.workspaceRef = 'workspace:foreign'
    }
    if (field === 'personal') {
      Object.assign(f.task, { run_scope: { kind: 'personal' } })
    }
    if (field === 'stage') {
      f.view.currentStageRef = f.view.stageTasks[1].stageRef
    }
    if (field === 'deadline') {
      f.admission.executionDeadlineAt = new Date(Date.now() - 1).toISOString()
    }
    const changed = structuredClone(f.task)
    await expect(f.client.prepareCaseRun(f.refs)).rejects.toThrow()
    expect(f.task).toEqual(changed)
    expect(f.issue).toHaveBeenCalledOnce()
    expect(f.bindingCommit).toHaveBeenCalledOnce()
    expect(f.unavailable).not.toHaveBeenCalled()
  })
  it.each([
    'revokeCaller',
    'revokeWorkspace',
    'revokeEnforcement',
    'closeRuntime',
    'switchAccount',
    'revokeSession',
    'signOut',
    'revokeOwner'
  ] as const)('refuses %s after a legitimate binding was committed', async (revoke) => {
    const f = await fixture()
    await f.client.prepareCaseRun(f.refs)
    const committed = structuredClone(f.task)
    f[revoke]()
    await expect(f.client.prepareCaseRun(f.refs)).rejects.toThrow()
    expect(f.task).toEqual(committed)
    expect(f.bindingCommit).toHaveBeenCalledOnce()
    expect(f.unavailable).not.toHaveBeenCalled()
  })
  it('rereads the Case when view and Task reads straddle the original binding commit', async () => {
    const f = await fixture()
    const binding = await f.issuer.issue({
      paperclipCompanyId: f.task.company_id,
      paperclipAgentId: f.task.agent_id,
      task: f.admission.run.task,
      workspaceSelector: f.admission.workspaceSelector,
      input: f.admission.input,
      executionMode: 'enforced_autonomous',
      executionDeadlineAt: f.admission.executionDeadlineAt,
      workflowContext: f.admission.workflowContext
    })
    f.beforeTaskRead.mockImplementationOnce(async () => {
      await f.bindingCommit(binding)
    })
    await expect(f.client.prepareCaseRun(f.refs)).resolves.toEqual(f.refs)
    expect(f.requests.filter(({ path }) => path.endsWith('/cases/read'))).toHaveLength(4)
    expect(f.bindingWrite).toHaveBeenCalledOnce()
    expect(f.bindingCommit).toHaveBeenCalledOnce()
    expect(f.unavailable).not.toHaveBeenCalled()
  })
})
