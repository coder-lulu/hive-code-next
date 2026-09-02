import { TUI_AGENT_CONFIG } from './tui-agent-config'
import { rewritePermissionArgs } from './tui-agent-permission-args'
import type { AgentStartupShell } from './tui-agent-startup-shell'
import type { TuiAgent } from './tui-agent'

export type AgentPermissionMode = 'yolo' | 'manual' | 'mixed'
export type AgentLaunchPermissionMode = 'default' | Exclude<AgentPermissionMode, 'mixed'>
export type AgentExplicitLaunchPermissionMode = Exclude<AgentLaunchPermissionMode, 'default'>

export const YOLO_TUI_AGENT_ARGS: Partial<Record<TuiAgent, string>> = {
  claude: '--dangerously-skip-permissions',
  'claude-agent-teams': '--dangerously-skip-permissions',
  openclaude: '--dangerously-skip-permissions',
  codex: '--dangerously-bypass-approvals-and-sandbox',
  gemini: '--yolo',
  antigravity: '--dangerously-skip-permissions',
  aider: '--yes-always',
  amp: '--dangerously-allow-all',
  kiro: '--trust-all-tools',
  crush: '--yolo',
  autohand: '--unrestricted',
  cline: '--auto-approve true',
  'command-code': '--yolo',
  continue: '--allow "*"',
  cursor: '--yolo',
  kimi: '--yolo',
  'mistral-vibe': '--agent auto-approve',
  'qwen-code': '--approval-mode yolo',
  rovo: '--yolo',
  hermes: '--yolo',
  copilot: '--yolo',
  grok: '--permission-mode bypassPermissions',
  devin: '--permission-mode bypass',
  ante: '--yolo',
  trae: '--yolo',
  droid: '--auto high'
}

export const YOLO_TUI_AGENT_ENV: Partial<Record<TuiAgent, Record<string, string>>> = {
  goose: { GOOSE_MODE: 'auto' }
}

const MANUAL_TUI_AGENT_ARGS: Partial<Record<TuiAgent, string>> = {
  // Explicit CLI values override unsafe profile/config defaults for this launch.
  claude: '--permission-mode manual',
  'claude-agent-teams': '--permission-mode manual',
  codex: '--ask-for-approval on-request --sandbox workspace-write',
  gemini: '--approval-mode default',
  grok: '--permission-mode default'
}

const TUI_AGENT_PERMISSION_ARG_ALIASES: Partial<Record<TuiAgent, readonly string[]>> = {
  claude: ['--permission-mode bypassPermissions'],
  'claude-agent-teams': ['--permission-mode bypassPermissions'],
  codex: [
    '--approve-for-me',
    '--full-auto',
    '--ask-for-approval on-request',
    '-a on-request',
    '--sandbox workspace-write',
    '-s workspace-write'
  ],
  gemini: ['-y', '--approval-mode yolo'],
  grok: ['--always-approve']
}

export function resolveTuiAgentPermissionArgForms(agent: TuiAgent): readonly string[] {
  const canonical = YOLO_TUI_AGENT_ARGS[agent]
  return [...(canonical ? [canonical] : []), ...(TUI_AGENT_PERMISSION_ARG_ALIASES[agent] ?? [])]
}

export function resolveTuiAgentPermissionTargetArgs(
  agent: TuiAgent,
  mode: AgentExplicitLaunchPermissionMode
): string {
  return mode === 'yolo' ? (YOLO_TUI_AGENT_ARGS[agent] ?? '') : (MANUAL_TUI_AGENT_ARGS[agent] ?? '')
}

const PERMISSION_AGENT_IDS = Object.keys(TUI_AGENT_CONFIG).filter(
  (agent): agent is TuiAgent => agent in YOLO_TUI_AGENT_ARGS || agent in YOLO_TUI_AGENT_ENV
)

export function supportsTuiAgentLaunchPermission(agent: TuiAgent): boolean {
  return agent in YOLO_TUI_AGENT_ARGS || agent in YOLO_TUI_AGENT_ENV
}

function normalizeArgs(value: string | null | undefined): string {
  return value?.trim() ?? ''
}

function deletePermissionEnv(
  env: Record<string, string>,
  name: string,
  shell: AgentStartupShell
): void {
  for (const candidate of Object.keys(env)) {
    if (
      candidate === name ||
      (shell !== 'posix' && candidate.toLowerCase() === name.toLowerCase())
    ) {
      delete env[candidate]
    }
  }
}

export function resolveTuiAgentLaunchPermission(args: {
  agent: TuiAgent
  mode: AgentLaunchPermissionMode
  agentArgs?: string | null
  agentEnv?: Record<string, string> | null
  shell: AgentStartupShell
}): { agentArgs: string; agentEnv: Record<string, string> } {
  const agentArgs = normalizeArgs(args.agentArgs)
  const agentEnv = { ...args.agentEnv }
  if (args.mode === 'default') {
    return { agentArgs, agentEnv }
  }

  const permissionArgForms = resolveTuiAgentPermissionArgForms(args.agent)
  const resolvedAgentArgs =
    permissionArgForms.length > 0
      ? (rewritePermissionArgs({
          agentArgs,
          permissionArgForms,
          targetPermissionArgs: resolveTuiAgentPermissionTargetArgs(args.agent, args.mode),
          shell: args.shell
        }) ?? agentArgs)
      : agentArgs
  for (const [name, value] of Object.entries(YOLO_TUI_AGENT_ENV[args.agent] ?? {})) {
    deletePermissionEnv(agentEnv, name, args.shell)
    if (args.mode === 'yolo') {
      agentEnv[name] = value
    }
  }
  return { agentArgs: resolvedAgentArgs, agentEnv }
}

function sameEnv(
  left: Record<string, string> | null | undefined,
  right: Record<string, string> | null | undefined
): boolean {
  const leftEntries = Object.entries(left ?? {})
  const rightEntries = Object.entries(right ?? {})
  if (leftEntries.length !== rightEntries.length) {
    return false
  }
  return leftEntries.every(([name, value]) => right?.[name] === value)
}

function resolveAgentPermissionMode(args: string, yoloArgs: string): AgentPermissionMode {
  if (!args) {
    return 'manual'
  }
  return args === yoloArgs ? 'yolo' : 'mixed'
}

function resolveAgentEnvPermissionMode(
  env: Record<string, string> | null | undefined,
  yoloEnv: Record<string, string> | undefined
): AgentPermissionMode {
  if (sameEnv(env, {})) {
    return 'manual'
  }
  return sameEnv(env, yoloEnv) ? 'yolo' : 'mixed'
}

function combinePermissionModes(modes: AgentPermissionMode[]): AgentPermissionMode {
  let sawYolo = false
  let sawManual = false
  let sawMixed = false

  for (const mode of modes) {
    if (mode === 'yolo') {
      sawYolo = true
    } else if (mode === 'manual') {
      sawManual = true
    } else {
      sawMixed = true
    }
  }

  if (sawMixed || (sawYolo && sawManual)) {
    return 'mixed'
  }
  return sawYolo ? 'yolo' : 'manual'
}

export function resolveTuiAgentPermissionMode(args: {
  agent: TuiAgent
  agentArgs?: string | null
  agentEnv?: Record<string, string> | null
}): AgentPermissionMode {
  const modes: AgentPermissionMode[] = []
  if (args.agent in YOLO_TUI_AGENT_ARGS) {
    modes.push(
      resolveAgentPermissionMode(
        normalizeArgs(args.agentArgs),
        YOLO_TUI_AGENT_ARGS[args.agent] ?? ''
      )
    )
  }
  if (args.agent in YOLO_TUI_AGENT_ENV) {
    modes.push(resolveAgentEnvPermissionMode(args.agentEnv, YOLO_TUI_AGENT_ENV[args.agent]))
  }

  return combinePermissionModes(modes)
}

export function resolveAgentPermissionModeSummary(args: {
  agentDefaultArgs?: Partial<Record<TuiAgent, string>> | null
  agentDefaultEnv?: Partial<Record<TuiAgent, Record<string, string>>> | null
}): AgentPermissionMode {
  const modes: AgentPermissionMode[] = []

  for (const agent of PERMISSION_AGENT_IDS) {
    modes.push(
      resolveTuiAgentPermissionMode({
        agent,
        agentArgs: args.agentDefaultArgs?.[agent],
        agentEnv: args.agentDefaultEnv?.[agent]
      })
    )
  }

  return combinePermissionModes(modes)
}

export function applyAgentPermissionMode(args: {
  mode: Exclude<AgentPermissionMode, 'mixed'>
  agentDefaultArgs?: Partial<Record<TuiAgent, string>> | null
  agentDefaultEnv?: Partial<Record<TuiAgent, Record<string, string>>> | null
}): {
  agentDefaultArgs: Partial<Record<TuiAgent, string>>
  agentDefaultEnv: Partial<Record<TuiAgent, Record<string, string>>>
} {
  const nextArgs = { ...args.agentDefaultArgs }
  const nextEnv = { ...args.agentDefaultEnv }

  for (const agent of PERMISSION_AGENT_IDS) {
    if (agent in YOLO_TUI_AGENT_ARGS) {
      const yoloArgs = YOLO_TUI_AGENT_ARGS[agent] ?? ''
      const currentArgs = normalizeArgs(nextArgs[agent])
      if (!currentArgs || currentArgs === yoloArgs) {
        nextArgs[agent] = args.mode === 'yolo' ? yoloArgs : ''
      }
    }

    if (agent in YOLO_TUI_AGENT_ENV) {
      const yoloEnv = YOLO_TUI_AGENT_ENV[agent]
      const currentEnv = nextEnv[agent]
      if (sameEnv(currentEnv, {}) || sameEnv(currentEnv, yoloEnv)) {
        nextEnv[agent] = args.mode === 'yolo' ? { ...yoloEnv } : {}
      }
    }
  }

  return { agentDefaultArgs: nextArgs, agentDefaultEnv: nextEnv }
}
