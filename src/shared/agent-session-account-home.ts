/**
 * The account an agent session is pinned to: the agent's config directory, and the environment
 * variable that points the agent at it.
 *
 * The variable is the agent's own (Claude reads `CLAUDE_CONFIG_DIR`, Codex `CODEX_HOME`), declared
 * by its definition, so a record stores it beside the path. Stored values are exactly what older
 * builds wrote and read.
 */

import type { AgentSessionStoredAgent } from './agent-session-stored-agent'

/** Account root pinned at launch by the account selector, so a resume cannot drift to another login. */
export type AgentSessionAccountHome = {
  /** Environment variable naming the agent's config directory. */
  variable: string
  /** Host-resolved absolute path in the execution host's own path syntax. */
  path: string
}

/** The account home of `agent` at `path`. */
export function agentSessionAccountHome(
  agent: Pick<AgentSessionStoredAgent, 'accountHomeVariable'>,
  path: string
): AgentSessionAccountHome {
  return { variable: agent.accountHomeVariable, path }
}

const ENVIRONMENT_VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/

/** Shape only: whether the variable is the one the record's agent pins is a launch-time question
 *  (`agentDrivesSession`), so an agent that renames its variable never hides its chats. */
export function isAgentSessionAccountHome(value: unknown): value is AgentSessionAccountHome {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const home = value as Partial<AgentSessionAccountHome>
  return (
    typeof home.variable === 'string' &&
    ENVIRONMENT_VARIABLE_NAME.test(home.variable) &&
    typeof home.path === 'string' &&
    home.path.length > 0 &&
    home.path.length <= 4096
  )
}
