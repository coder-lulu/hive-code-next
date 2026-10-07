import {
  openCodexAppServerConnection,
  type CodexAppServerConnectionHandlers
} from './codex-app-server-connection'
import type { CodexStructuredLaunch } from './codex-structured-session-state'
import type { StructuredAgentSessionAcquireInput } from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import { buildCodexStructuredChildEnvironment } from './codex-structured-child-environment'

/** Opens the selected transport after the original acquire path has checked its spawn guard. */
export function openCodexStructuredConnection(
  launch: CodexStructuredLaunch,
  input: Pick<StructuredAgentSessionAcquireInput, 'identity' | 'spawnToken'>,
  open: typeof openCodexAppServerConnection | undefined,
  handlers: CodexAppServerConnectionHandlers
) {
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
