import type { TuiAgent } from './tui-agent'
import type { AgentNpmRegistry } from './agent-npm-registry'

export type LatestAgentVersionRequest = { agent: TuiAgent; registry?: AgentNpmRegistry }

export type AgentVersionRequest = {
  agent: TuiAgent
  commandOverride?: string
  wslDistro?: string | null
}

export type AgentVersionResult = {
  status: 'ready' | 'unsupported' | 'error'
  version: string | null
  reason?: string
}

export type LatestAgentVersionResult = AgentVersionResult & {
  packageName?: string
  sourceUrl?: string
  channel: 'npm-latest' | 'github-release' | 'pypi-latest'
}
