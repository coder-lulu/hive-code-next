import type { TuiAgent } from './tui-agent'
import type { AgentNpmRegistry } from './agent-npm-registry'

export const NPM_AGENT_PACKAGES: Partial<Record<TuiAgent, string>> = {
  claude: '@anthropic-ai/claude-code',
  codex: '@openai/codex',
  gemini: '@google/gemini-cli',
  pi: '@earendil-works/pi-coding-agent',
  opencode: 'opencode-ai',
  grok: '@xai-official/grok',
  openclaw: 'openclaw',
  autohand: 'autohand-cli',
  kilo: '@kilocode/cli',
  aug: '@augmentcode/auggie',
  amp: '@ampcode/cli',
  cline: 'cline',
  omp: '@oh-my-pi/pi-coding-agent',
  copilot: '@github/copilot',
  codebuff: 'codebuff',
  'command-code': 'command-code',
  continue: '@continuedev/cli',
  'qwen-code': '@qwen-code/qwen-code',
  openclaude: '@gitlawb/openclaude',
  crush: '@charmland/crush',
  droid: 'droid',
  kimi: '@moonshot-ai/kimi-code'
}

export type AgentInstallRequest = {
  agent: TuiAgent
  wslDistro?: string | null
  action?: 'install' | 'upgrade'
  registry?: AgentNpmRegistry
  commandOverride?: string
  expectedRealPath?: string
}

export type AgentInstallResult = {
  status: 'installed' | 'unsupported' | 'error'
  version: string | null
  reason?: string
  output?: string
  previousVersion?: string
  command?: string
}
