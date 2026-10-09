import { assertSynchronousAuthorization } from '../../shared/synchronous-authorization-guard'
import { agentSessionRefusalError } from '../../shared/agent-session-wire-refusals'
import { AgentSessionPreSpawnError } from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import {
  openCodexAppServerConnection,
  type CodexAppServerConnectionHandlers
} from './codex-app-server-connection'
import type { CodexStructuredLaunch } from './codex-structured-session-state'
import type { StructuredAgentSessionAcquireInput } from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import { buildCodexStructuredChildEnvironment } from './codex-structured-child-environment'

/** Checks acquisition authority immediately before opening the selected transport. */
export async function openCodexStructuredConnection(
  launch: CodexStructuredLaunch,
  input: Pick<StructuredAgentSessionAcquireInput, 'identity' | 'spawnToken' | 'spawnGuard'>,
  open: typeof openCodexAppServerConnection | undefined,
  handlers: CodexAppServerConnectionHandlers,
  assertCurrent: () => void
) {
  const guard = input.spawnGuard
  if (guard) {
    try {
      const prepared = await guard.prepare()
      assertCurrent()
      if (prepared !== undefined) {
        throw agentSessionRefusalError('agent_session_operation_invalid', {
          reason: 'requestMalformed'
        })
      }
      assertSynchronousAuthorization(
        () => guard.assertCurrent(),
        () => {
          throw agentSessionRefusalError('agent_session_operation_invalid', {
            reason: 'requestMalformed'
          })
        }
      )
    } catch (error) {
      throw new AgentSessionPreSpawnError(error)
    }
  }
  if (launch.openTaskConnection) {
    return launch.openTaskConnection(handlers)
  }
  return (open ?? openCodexAppServerConnection)(
    {
      command: launch.command,
      args: launch.args,
      cwd: launch.cwd,
      env: buildCodexStructuredChildEnvironment(launch, input.spawnToken, input.identity.sessionId)
    },
    handlers
  )
}
