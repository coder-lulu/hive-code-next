import type { TuiAgent } from './tui-agent'
import { NPM_AGENT_PACKAGES } from './agent-install-types'

export type AgentInstallProvider =
  | { kind: 'npm' | 'bun'; packageName: string }
  | { kind: 'uv'; packageName: string }
  | {
      kind: 'script'
      posixUrl?: string
      windowsUrl?: string
      posixArgs?: readonly string[]
      windowsArgs?: readonly string[]
      env?: Record<string, string>
      unsupportedArchitectures?: readonly string[]
    }
  | { kind: 'dependency'; agent: TuiAgent }
  | { kind: 'binary'; urls: Record<string, string> }

export const AGENT_INSTALL_PROVIDERS: Partial<Record<TuiAgent, AgentInstallProvider>> = {
  ...Object.fromEntries(
    Object.entries(NPM_AGENT_PACKAGES).map(([agent, packageName]) => [
      agent,
      { kind: 'npm', packageName }
    ])
  ),
  omp: { kind: 'bun', packageName: '@oh-my-pi/pi-coding-agent' },
  aider: { kind: 'uv', packageName: 'aider-chat' },
  'mistral-vibe': { kind: 'uv', packageName: 'mistral-vibe' },
  hermes: {
    kind: 'script',
    posixUrl: 'https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh',
    windowsUrl:
      'https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1',
    posixArgs: ['--skip-setup', '--non-interactive'],
    windowsArgs: ['-NonInteractive']
  },
  'prime-agent': {
    kind: 'script',
    posixUrl: 'https://app.primeintellect.ai/prime-agent/install.sh'
  },
  antigravity: {
    kind: 'script',
    posixUrl: 'https://antigravity.google/cli/install.sh',
    windowsUrl: 'https://antigravity.google/cli/install.ps1',
    posixArgs: ['--skip-aliases'],
    windowsArgs: ['--skip-aliases']
  },
  devin: {
    kind: 'script',
    posixUrl: 'https://cli.devin.ai/install.sh',
    windowsUrl: 'https://static.devin.ai/cli/setup.ps1'
  },
  trae: {
    kind: 'script',
    posixUrl: 'https://trae.cn/trae-cli/install_v2.sh',
    windowsUrl: 'https://trae.cn/trae-cli/install_v2.ps1'
  },
  ante: { kind: 'script', posixUrl: 'https://ante.run/install.sh' },
  kiro: { kind: 'script', posixUrl: 'https://cli.kiro.dev/install' },
  cursor: {
    kind: 'script',
    posixUrl: 'https://cursor.com/install',
    windowsUrl: 'https://cursor.com/install?win32=true'
  },
  goose: {
    kind: 'script',
    posixUrl: 'https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh',
    windowsUrl: 'https://raw.githubusercontent.com/aaif-goose/goose/main/download_cli.ps1',
    env: { CONFIGURE: 'false' },
    unsupportedArchitectures: ['win32-arm64']
  },
  rovo: {
    kind: 'binary',
    urls: {
      'darwin-x64': 'https://acli.atlassian.com/darwin/latest/acli_darwin_amd64/acli',
      'darwin-arm64': 'https://acli.atlassian.com/darwin/latest/acli_darwin_arm64/acli',
      'linux-x64': 'https://acli.atlassian.com/linux/latest/acli_linux_amd64/acli',
      'linux-arm64': 'https://acli.atlassian.com/linux/latest/acli_linux_arm64/acli',
      'win32-x64': 'https://acli.atlassian.com/windows/latest/acli_windows_amd64/acli.exe',
      'win32-arm64': 'https://acli.atlassian.com/windows/latest/acli_windows_arm64/acli.exe'
    }
  },
  'claude-agent-teams': { kind: 'dependency', agent: 'claude' }
}

export const AGENT_UPGRADE_COMMANDS: Partial<Record<TuiAgent, readonly string[]>> = {
  claude: ['update'],
  grok: ['update'],
  opencode: ['upgrade'],
  omp: ['update'],
  hermes: ['update'],
  cursor: ['update'],
  droid: ['update']
}
