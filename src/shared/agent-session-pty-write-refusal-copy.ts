import type { AgentSessionPtyWriteRefusal } from './agent-session-pty-write-admission'
import { PRIMARY_CLI_COMMAND } from './brand'

export function structuredChatPtyWriteRefusalCopy(
  refusal: AgentSessionPtyWriteRefusal,
  action: 'terminal-send' | 'worker-start'
): string | null {
  if (refusal.ownerRuntimeKind !== 'native') {
    return null
  }
  return action === 'worker-start'
    ? `The target terminal is in Structured Chat. Switch it to Terminal, then retry \`${PRIMARY_CLI_COMMAND} orchestration worker-start\`.`
    : `The target terminal is in Structured Chat. Switch it to Terminal, then retry \`${PRIMARY_CLI_COMMAND} terminal send\`.`
}
