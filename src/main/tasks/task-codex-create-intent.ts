import type { AgentSessionExecutionLocation } from '../../shared/agent-session-record'
import {
  TaskSessionSourceReferenceSchema,
  TaskStructuredBindingSchema
} from '../../shared/task-execution/task-structured-binding'
import {
  TaskDigest,
  TaskLaunchOperationId,
  TaskOpaqueRef
} from '../../shared/task-execution/task-execution-primitives'
import type { AgentSessionAttachParams } from '../native-chat/agent-session-wire/structured-agent-session-attach'
import type { TaskCodexAccountScope } from './task-codex-account-scope'
import { taskCodexLaunchOptions } from './task-codex-launch-options'
import {
  assertTaskAuthorizationCurrent,
  type TaskStructuredLaunchOrigin
} from './task-structured-launch-origin'
import { refuseTaskExecution } from './task-execution-error'

export async function resolveTaskCodexCreateIntent(options: {
  input: {
    envelope: { sessionId: string; clientOperationId: string }
    worktree: string
    agent: 'claude' | 'codex'
    callerKey?: string
    resumeFrom?: { providerSessionId: string }
    taskOrigin?: TaskStructuredLaunchOrigin
  }
  resolveLocation: (selector: string) => Promise<AgentSessionExecutionLocation>
  resolveSelectedAccount?: () => TaskCodexAccountScope
}): Promise<AgentSessionAttachParams> {
  const { input } = options
  const origin = input.taskOrigin
  if (
    !origin ||
    typeof origin.validate !== 'function' ||
    input.agent !== 'codex' ||
    Object.hasOwn(input, 'resumeFrom') ||
    input.callerKey !== origin.operationCallerKey ||
    !TaskOpaqueRef.safeParse(origin.operationCallerKey).success ||
    !TaskLaunchOperationId.safeParse(origin.operationId).success ||
    !TaskDigest.safeParse(origin.launchFingerprint).success
  ) {
    return refuseTaskExecution('FORBIDDEN')
  }
  const source = TaskSessionSourceReferenceSchema.safeParse(origin.source)
  if (!source.success) {
    return refuseTaskExecution('FORBIDDEN')
  }
  const assertCurrent = () => assertTaskAuthorizationCurrent(() => origin.validate())
  assertCurrent()
  const location = await options.resolveLocation(input.worktree)
  assertCurrent()
  const parsed = TaskStructuredBindingSchema.shape.location.safeParse(location)
  if (!parsed.success || input.worktree !== `id:${parsed.data.workspaceId}`) {
    return refuseTaskExecution('FORBIDDEN')
  }
  if (typeof options.resolveSelectedAccount !== 'function') {
    throw new Error('TASK_MODEL_AUTH_SCOPE_UNAVAILABLE')
  }
  const account = options.resolveSelectedAccount()
  assertCurrent()
  assertTaskAuthorizationCurrent(() => account.assertCurrent())
  assertCurrent()
  return {
    envelope: { ...input.envelope, expectedRuntimeFence: null, payloadFingerprint: '' },
    location: parsed.data,
    provider: 'codex',
    agent: 'codex',
    runtimeKind: 'native',
    accountHome: { variable: 'CODEX_HOME', path: account.codexHome },
    options: taskCodexLaunchOptions(),
    taskOrigin: { ...origin, source: source.data }
  }
}
