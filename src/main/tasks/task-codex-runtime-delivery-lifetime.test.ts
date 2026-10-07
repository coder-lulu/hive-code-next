import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { acquireOwner } from '../native-chat/agent-session-wire/structured-agent-session-acquisition'
import { taskCodexRuntimeFixture } from './task-codex-runtime.test-fixture'
import { createTaskDeliveryAuthorizer } from './task-delivery-authority'
import { createTaskExecutionLaunchAuthorization } from './task-execution-launch-authorization'
import { taskDockerModelProfile } from './task-docker-model-profile'
import { modelStartParams } from './task-model-broker.test-fixture'
import { TASK_TEST_NOW } from './task-execution.test-fixture'
import { TASK_MODEL_RPC_START } from './task-model-channel-protocol'

let fixture: Awaited<ReturnType<typeof taskCodexRuntimeFixture>> | undefined
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(TASK_TEST_NOW)
})
afterEach(async () => {
  fixture?.docker.keepLive(false)
  await fixture?.adapter.closeAll()
  vi.restoreAllMocks()
  fixture = undefined
})

describe('original controlled Runtime delivery handoff', () => {
  it('continues model admission after binding and delivery expiry while refusing another dispatch', async () => {
    fixture = await taskCodexRuntimeFixture({
      spaceId: randomUUID(),
      taskId: randomUUID(),
      runId: randomUUID(),
      attempt: 1,
      taskRevision: '0'
    })
    const f = fixture
    const record = f.store.tasks.get(f.command)
    if (!record) {
      throw new Error('original Task missing')
    }
    let tick = 1000
    const token = { ownerId: 'gateway:offline', leaseRef: 'lease:offline', generation: 1 }
    const proof = {
      ...token,
      accountId: 'synthetic-hive-account',
      companyId: f.command.task.spaceId,
      taskId: f.command.task.taskId,
      runId: f.command.task.runId,
      protocolVersion: f.command.protocolVersion,
      runtimeRecordId: f.command.runtimeRecordId,
      ownershipEpoch: f.command.ownershipEpoch,
      executionId: f.command.executionId,
      executionEpoch: f.command.executionEpoch,
      operationId: f.command.operationId,
      workspaceExecutionClaimRef: f.command.workspaceExecutionClaimRef,
      writeFence: f.command.writeFence,
      commandFingerprint: record.commandFingerprint,
      cursor: 0,
      serverNow: new Date(TASK_TEST_NOW).toISOString(),
      expiresAt: new Date(TASK_TEST_NOW + 30_000).toISOString()
    }
    const baseCurrent = vi.fn(() => undefined)
    const privateRequest = vi.fn(async () => proof)
    const authorizer = createTaskDeliveryAuthorizer({
      authorize: async () => ({
        workspace: record.workspace,
        input: 'Offline task.',
        assertCurrent: baseCurrent
      }),
      context: async () => ({
        accountId: proof.accountId,
        accountRef: 'account:offline',
        assertCurrent: () => undefined,
        request: privateRequest
      }),
      monotonicNow: () => tick
    })
    const authorization = createTaskExecutionLaunchAuthorization(
      f.store.tasks,
      record,
      await authorizer(
        { operationCallerKey: record.operationCallerKey, delivery: token },
        f.command,
        'start'
      )
    )
    f.origin.dispatch = authorization.dispatch
    f.validate.mockImplementation(() => {
      authorization.assertCurrent()
      return undefined
    })
    const acquired = await acquireOwner(f.flow, f.record)
    await f.store.tasks.bindLaunch(
      f.store.tasks.get(f.command)!,
      {
        worktreeId: record.workspace.workspaceId,
        outcome: {
          kind: 'structured',
          sessionId: acquired.record.sessionId,
          handle: 'offline-handle'
        },
        receipt: {
          mode: 'structured',
          preferred: 'structured',
          reason: 'user_default',
          detail: 'Offline transport.'
        }
      },
      TASK_TEST_NOW
    )
    tick += 60_001
    vi.mocked(Date.now).mockReturnValue(TASK_TEST_NOW + 60_001)
    expect(authorization.assertCurrent).not.toThrow()
    expect(authorization.dispatch?.assertCurrent).toThrow('OUTCOME_UNKNOWN')
    const requestsBefore = privateRequest.mock.calls.length
    const raw = f.codex.connections[0]
    if (!raw?.handlers.onServerRequest) {
      throw new Error('original model port missing')
    }
    const profile = taskDockerModelProfile()
    raw.handlers.onServerRequest({
      id: `hive-model-${randomUUID()}-0`,
      method: TASK_MODEL_RPC_START,
      params: modelStartParams({
        model: profile.model,
        input: [
          { type: 'additional_tools', role: 'developer', tools: profile.approvedTools },
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Write report.' }]
          }
        ],
        tool_choice: 'auto',
        parallel_tool_calls: false,
        reasoning: { effort: 'low', context: 'all_turns' },
        store: false,
        stream: true,
        include: ['reasoning.encrypted_content']
      })
    })
    await vi.waitFor(() => expect(f.readAuth).toHaveBeenCalledOnce())
    expect(f.store.tasks.get(f.command)?.modelDispatchAttempts).toBe(1)
    expect(privateRequest).toHaveBeenCalledTimes(requestsBefore)
    expect(f.nativeOpen).not.toHaveBeenCalled()
  })
})
