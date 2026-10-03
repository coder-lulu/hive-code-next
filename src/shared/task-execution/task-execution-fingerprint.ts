import { canonicalAgentSessionDigest } from '../agent-session-mutation-envelope'
import { TaskExecutionStartSchema } from './task-execution-command'
import { TaskOpaqueRef } from './task-execution-primitives'

/** The caller key comes from authenticated host context, never from the command body. */
export function computeTaskExecutionFingerprint(commandValue: unknown, operationCallerKey: string) {
  TaskOpaqueRef.parse(operationCallerKey)
  const { authorizationRef, expiresAt, requiredCapabilities, ...requirements } =
    TaskExecutionStartSchema.parse(commandValue)
  // Renewable authorization is checked afresh; it does not change the operation's identity.
  void authorizationRef
  void expiresAt
  return canonicalAgentSessionDigest({
    domain: 'hive.task.execution:1',
    operationCallerKey,
    ...requirements,
    requiredCapabilities: [...new Set(requiredCapabilities)].sort()
  })
}
