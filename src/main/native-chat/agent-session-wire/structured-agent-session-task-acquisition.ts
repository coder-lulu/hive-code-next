import { agentSessionRefusalError } from '../../../shared/agent-session-wire-refusals'
import { assertSynchronousAuthorization } from '../../../shared/synchronous-authorization-guard'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import { reserveRequestFor } from './structured-agent-session-attach'
import type { AttachFlowInput } from './structured-agent-session-attach-flow'
import {
  prepareTaskDispatch,
  requireTaskDispatchAuthorization
} from '../../tasks/task-dispatch-authorization'

export async function assertTaskAttachCurrent(
  input: AttachFlowInput,
  record: AgentSessionRecord
): Promise<void> {
  if (!Object.hasOwn(input.params, 'taskOrigin') && !Object.hasOwn(record, 'taskSource')) {
    return
  }
  await prepareTaskDispatch(
    requireTaskDispatchAuthorization(input.params.taskOrigin?.dispatch),
    () => assertTaskAttachAuthorityCurrent(input, record)
  )
  await input.store.assertTaskAcquisition(
    reserveRequestFor({
      sessionId: record.sessionId,
      params: input.params,
      authority: input.authority,
      callerKey: input.callerKey,
      fingerprint: input.params.envelope.payloadFingerprint,
      now: input.now()
    }),
    record
  )
  // The file transaction awaited; check current authority again at the effect boundary.
  assertTaskAttachAuthorityCurrent(input, record)
  assertSynchronousAuthorization(
    () => requireTaskDispatchAuthorization(input.params.taskOrigin?.dispatch).assertCurrent(),
    () => {
      throw agentSessionRefusalError('agent_session_operation_invalid', {
        reason: 'requestMalformed'
      })
    }
  )
}

export function assertTaskAttachAuthorityCurrent(
  input: AttachFlowInput,
  record: AgentSessionRecord
): void {
  if (!Object.hasOwn(input.params, 'taskOrigin') && !Object.hasOwn(record, 'taskSource')) {
    return
  }
  const refuse = (): never => {
    throw agentSessionRefusalError('agent_session_operation_invalid', {
      reason: 'requestMalformed'
    })
  }
  const origin = input.params.taskOrigin
  if (!origin || typeof origin.validate !== 'function') {
    return refuse()
  }
  assertSynchronousAuthorization(() => origin.validate(), refuse)
}
