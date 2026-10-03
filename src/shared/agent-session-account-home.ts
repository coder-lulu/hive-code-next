/** Account root pinned at launch so a resume cannot drift to another login. */
export type AgentSessionAccountHome = {
  variable: 'CLAUDE_CONFIG_DIR' | 'CODEX_HOME' | 'PI_CODING_AGENT_DIR'
  /** Host-resolved absolute path in the execution host's own path syntax. */
  path: string
}

export function isAgentSessionAccountHome(value: unknown): value is AgentSessionAccountHome {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const home = value as Partial<AgentSessionAccountHome>
  return (
    (home.variable === 'CLAUDE_CONFIG_DIR' ||
      home.variable === 'CODEX_HOME' ||
      home.variable === 'PI_CODING_AGENT_DIR') &&
    typeof home.path === 'string' &&
    home.path.length > 0 &&
    home.path.length <= 4096
  )
}
