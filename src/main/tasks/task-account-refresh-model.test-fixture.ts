import type { LocalTaskBindingIssuer } from './local-task-binding-issuer'
import type { AgentSessionRecordStore } from '../runtime/agent-session-record-store'
import type { TaskExecutionStart } from '../../shared/task-execution/task-execution-command'
import { taskStructuredFixture } from './task-structured-reservation.test-fixture'
import { canonicalAgentSessionDigest } from '../../shared/agent-session-mutation-envelope'
import { taskSessionSourceReference } from '../../shared/task-execution/task-structured-binding'
import { TASK_TEST_NOW } from './task-execution.test-fixture'

/** Synthetic offline original Task reservation, owner proof and debit through the real store. */
export async function addRefreshModelTestTask(
  issuer: LocalTaskBindingIssuer,
  records: AgentSessionRecordStore,
  task: TaskExecutionStart['task'],
  caller: { operationCallerKey: string },
  index: number
) {
  const next = await issuer.issue({
    paperclipCompanyId: 'company:offline',
    paperclipAgentId: 'agent:offline',
    task: { ...task, taskId: `task:${index}`, runId: `run:${index}` },
    workspaceSelector: 'id:offline-source',
    input: 'Synthetic offline additional Task'
  })
  const nextGrant = issuer.resolveGrant(next.command.authorizationRef)!
  const fixture = taskStructuredFixture(nextGrant.workspace, next.command.task, next.command)
  fixture.origin.operationCallerKey = caller.operationCallerKey
  fixture.origin.validate = nextGrant.assertCurrent
  fixture.request.sessionId = `offline-session-${index}`
  fixture.request.claimKeyId = `offline-claim-${index}`
  fixture.request.spawnToken = `offline-spawn-${index}`
  fixture.request.operation.callerKey = caller.operationCallerKey
  fixture.request.operation.fingerprint = canonicalAgentSessionDigest({
    method: 'agentSession.attach',
    sessionId: fixture.request.sessionId
  })
  await records.tasks.admit({
    command: next.command,
    ...caller,
    workspace: nextGrant.workspace,
    now: TASK_TEST_NOW,
    validate: nextGrant.assertCurrent
  })
  await records.tasks.beginDispatch(next.command, TASK_TEST_NOW, nextGrant.assertCurrent)
  fixture.origin.source = taskSessionSourceReference(records.tasks.get(next.command)!)
  const outer = { ...fixture.outer, callerKey: caller.operationCallerKey }
  await records.admitOperation({ ...outer, now: TASK_TEST_NOW })
  await records.claimOperation(outer)
  const reserved = await records.reserveOwner(fixture.request)
  await records.commitProcessIdentity({
    sessionId: reserved.record.sessionId,
    fence: reserved.record.lease.runtimeFence,
    process: {
      hostId: 'local',
      pid: 4000 + index,
      processStartTimeMs: TASK_TEST_NOW - 1000,
      spawnToken: fixture.request.spawnToken!
    },
    now: TASK_TEST_NOW
  })
  await records.proveOwner({
    sessionId: reserved.record.sessionId,
    fence: reserved.record.lease.runtimeFence,
    link: {
      linkId: `offline-link-${index}`,
      handle: { provider: 'codex', threadId: `offline-thread-${index}` },
      origin: 'created',
      mintedAtFence: 1,
      observedAt: TASK_TEST_NOW
    },
    now: TASK_TEST_NOW
  })
  const original = records.tasks.get(next.command)!
  const structured = original.structuredBinding!
  await records.tasks.reserveModelDispatch(structured, TASK_TEST_NOW, nextGrant.assertCurrent)
  return { task: original, structured }
}
