import { agentPermissionHostPlatform, permissionEnvNameMatches } from './agent-permission-env'
import type { SleepingAgentLaunchConfig } from './agent-session-resume'
import type { GlobalSettings } from './global-settings-types'
import { isTuiAgent } from './tui-agent-config'
import { YOLO_TUI_AGENT_ARGS } from './tui-agent-permissions'
import {
  readLaunchPermissionChoice,
  type AgentPermissionChoice,
  agentPermissionEnv,
  resolveAgentPermission,
  sanitizeAgentPermissionUpdates
} from './tui-agent-permission-choice'
import { projectAgentLaunchProfile } from './agent-launch-profile'
import {
  resolveStartupShell,
  tokenizeStartupCommand,
  type AgentStartupShell
} from './tui-agent-startup-shell'
import type { TuiAgent } from './tui-agent'
import { resolveLocalWindowsAgentStartupShell } from './windows-terminal-shell'

const UNSUPPORTED_TUI_AGENT_ARGS: Partial<Record<TuiAgent, readonly string[]>> = {
  opencode: ['--dangerously-skip-permissions'],
  kilo: ['--dangerously-skip-permissions']
}

/** What a launch reads: the user's Arguments and env plus the stored permission choice. */
export type AgentLaunchProfileSettings = Partial<
  Pick<
    GlobalSettings,
    'agentDefaultArgs' | 'agentDefaultEnv' | 'agentPermissionDefault' | 'agentPermissionOverrides'
  >
>

/** Launch intent overrides only HiveCode's injected permission, preserving the user's args and env. */
export function agentLaunchPermissionSettings<T extends AgentLaunchProfileSettings>(
  agent: TuiAgent,
  settings: T,
  sessionOptions: Readonly<Record<string, unknown>> | undefined
) {
  const choice = readLaunchPermissionChoice(sessionOptions)
  return choice
    ? {
        ...settings,
        agentPermissionDefault: settings?.agentPermissionDefault ?? 'own',
        agentPermissionOverrides: { ...settings?.agentPermissionOverrides, [agent]: choice }
      }
    : settings
}

// Provider-own adds no permission arguments or environment.
export const DEFAULT_TUI_AGENT_ARGS: Partial<Record<TuiAgent, string>> &
  Readonly<Record<string, string | undefined>> = {}

export const DEFAULT_TUI_AGENT_ENV: Partial<Record<string, Record<string, string>>> = {}

function argPattern(arg: string): RegExp {
  return new RegExp(`(^|\\s)${arg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'g')
}

export function hasUnsupportedTuiAgentArgs(agent: TuiAgent, value: unknown): boolean {
  if (typeof value !== 'string') {
    return false
  }
  return (UNSUPPORTED_TUI_AGENT_ARGS[agent] ?? []).some((arg) => argPattern(arg).test(value))
}

/** Inspect current argv without treating quoted text or operands after -- as permission flags. */
export function tuiAgentArgsBypassPermissions(
  agent: TuiAgent,
  value: string | null | undefined,
  shell: AgentStartupShell
): boolean {
  const bypassArg = agent === 'devin' ? '--permission-mode bypass' : YOLO_TUI_AGENT_ARGS[agent]
  if (typeof value !== 'string' || bypassArg === undefined) {
    return false
  }
  const tokenized = tokenizeStartupCommand(value, shell)
  const bypass = tokenizeStartupCommand(bypassArg, shell)
  if (!tokenized.ok || !bypass.ok || bypass.tokens.length === 0) {
    return false
  }
  const terminator = tokenized.tokens.indexOf('--')
  const options = terminator === -1 ? tokenized.tokens : tokenized.tokens.slice(0, terminator)
  // A token sequence: several agents' bypass is a flag and its value (`--permission-mode X`).
  return options.some((_, start) =>
    bypass.tokens.every((token, offset) => options[start + offset] === token)
  )
}

function sanitizeTuiAgentLaunchArgs(agent: TuiAgent, args: string): string {
  const unsupportedArgs = UNSUPPORTED_TUI_AGENT_ARGS[agent]
  if (!unsupportedArgs) {
    return args.trim()
  }
  // Some interactive agent commands removed, relocated or never supported these skip-permission flags.
  return unsupportedArgs.reduce((next, arg) => next.replace(argPattern(arg), ' '), args).trim()
}

export function normalizeTuiAgentArgsRecord(value: unknown): Partial<Record<TuiAgent, string>> {
  const normalized: Partial<Record<TuiAgent, string>> = {}
  if (!value || typeof value !== 'object') {
    return normalized
  }
  for (const [agent, args] of Object.entries(value)) {
    if (!isTuiAgent(agent) || typeof args !== 'string') {
      continue
    }
    normalized[agent] = sanitizeTuiAgentLaunchArgs(agent, args)
  }
  return normalized
}

export function normalizeTuiAgentEnvRecord(
  value: unknown
): Partial<Record<TuiAgent, Record<string, string>>> {
  const normalized: Partial<Record<TuiAgent, Record<string, string>>> = {}
  if (!value || typeof value !== 'object') {
    return normalized
  }
  for (const [agent, env] of Object.entries(value)) {
    if (!isTuiAgent(agent) || !env || typeof env !== 'object') {
      continue
    }
    const entries: [string, string][] = []
    for (const [name, raw] of Object.entries(env)) {
      const key = name.trim()
      if (!key || typeof raw !== 'string') {
        continue
      }
      entries.push([key, raw])
    }
    normalized[agent] = Object.fromEntries(entries)
  }
  return normalized
}

/** Normalizes a settings write's launch profile in place, wherever the write lands. */
export function sanitizeAgentLaunchProfileUpdates(
  target: Partial<GlobalSettings>,
  updates: Partial<GlobalSettings>
): void {
  if ('agentDefaultArgs' in updates) {
    target.agentDefaultArgs = normalizeTuiAgentArgsRecord(updates.agentDefaultArgs)
  }
  if ('agentDefaultEnv' in updates) {
    target.agentDefaultEnv = normalizeTuiAgentEnvRecord(updates.agentDefaultEnv)
  }
  sanitizeAgentPermissionUpdates(target, updates)
}

export function getTuiAgentDefaultArgs(agent: string): string {
  const value: unknown = Object.getOwnPropertyDescriptor(DEFAULT_TUI_AGENT_ARGS, agent)?.value
  return typeof value === 'string' ? value : ''
}

export function getTuiAgentDefaultEnv(agent: string): Record<string, string> {
  return { ...DEFAULT_TUI_AGENT_ENV[agent] }
}

function ownArgs(agent: string, settings: AgentLaunchProfileSettings | null | undefined) {
  const configured = settings?.agentDefaultArgs
  const value: unknown = configured && Object.getOwnPropertyDescriptor(configured, agent)?.value
  return typeof value === 'string' ? value : undefined
}

export { agentPermissionArgsForLaunch } from './agent-permission-args'
/** Compose stored permission flags with user arguments, letting explicit user permission text win. Explicit user permission arguments take precedence. */
export function resolveTuiAgentLaunchArgs(
  agent: string,
  settings: AgentLaunchProfileSettings | null | undefined,
  permissionChoice?: AgentPermissionChoice
): string {
  if (!isTuiAgent(agent)) {
    return ownArgs(agent, settings) ?? getTuiAgentDefaultArgs(agent)
  }
  return projectAgentLaunchProfile(agent, settings, {
    target: 'terminal',
    ...(permissionChoice ? { choices: { permissionMode: permissionChoice } } : {})
  }).args
}

/** Inspect the actual current launch arguments for a permission bypass. */
export function resolvedTuiAgentArgsBypassPermissions(
  agent: TuiAgent,
  settings:
    | (AgentLaunchProfileSettings & Partial<Pick<GlobalSettings, 'terminalWindowsShell'>>)
    | null
    | undefined,
  platform: NodeJS.Platform
): boolean {
  const shell = resolveStartupShell(
    platform,
    resolveLocalWindowsAgentStartupShell({
      platform,
      isRemote: false,
      terminalWindowsShell: settings?.terminalWindowsShell
    })
  )
  return tuiAgentArgsBypassPermissions(agent, resolveTuiAgentLaunchArgs(agent, settings), shell)
}

/** The env a terminal launch of this agent gets; the user's own entries win over HiveCode's. */
export function resolveTuiAgentLaunchEnv(
  agent: string,
  settings: AgentLaunchProfileSettings | null | undefined,
  platform: NodeJS.Platform | null | undefined = agentPermissionHostPlatform(),
  visitBaseEntry?: (name: string, value: string) => true
): Record<string, string> {
  const configured = settings?.agentDefaultEnv
  const value: unknown = configured && Object.getOwnPropertyDescriptor(configured, agent)?.value
  const own =
    value && typeof value === 'object'
      ? Object.entries(value).filter(
          (entry): entry is [string, string] =>
            typeof entry[1] === 'string' && (visitBaseEntry?.(entry[0], entry[1]) ?? true)
        )
      : undefined
  if (!isTuiAgent(agent)) {
    const entries = own ?? Object.entries(getTuiAgentDefaultEnv(agent))
    if (!own) {
      entries.forEach(([name, value]) => visitBaseEntry?.(name, value))
    }
    return Object.fromEntries(entries)
  }
  const added = Object.entries(
    agentPermissionEnv(agent, resolveAgentPermission(agent, settings).choice)
  ).filter(([name]) => !own?.some(([key]) => permissionEnvNameMatches(key, name, platform)))
  return Object.fromEntries(added.length ? [...added, ...(own ?? [])] : (own ?? []))
}

/** Resume only the recorded recipe; defaults would grant bypass to unrecorded manual launches that never used it. */
export function resolveResumeLaunchRecipe(
  launchConfig: SleepingAgentLaunchConfig | undefined
): SleepingAgentLaunchConfig {
  if (!launchConfig) {
    throw new Error('Saved launch recipe is unavailable')
  }
  return {
    agentArgs: launchConfig.agentArgs,
    agentEnv: { ...launchConfig.agentEnv },
    ...(launchConfig.hostDefaultsAuthoritative ? { hostDefaultsAuthoritative: true as const } : {}),
    ...(launchConfig.agentPermissionMode
      ? { agentPermissionMode: launchConfig.agentPermissionMode }
      : {}),
    ...(launchConfig.agentCommand ? { agentCommand: launchConfig.agentCommand } : {}),
    ...(launchConfig.ompResumeFilePath ? { ompResumeFilePath: launchConfig.ompResumeFilePath } : {})
  }
}
