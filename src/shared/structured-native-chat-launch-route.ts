/**
 * The one place that answers "should this launch be a structured native chat session?".
 *
 * Both launch surfaces call it. The renderer asks when a user opens an agent tab
 * (`resolveAgentLaunchRoute`); orchestration asks when it dispatches a worker, because the mode is
 * the user's own default rather than a per-call flag. Keeping the two halves — the settings default
 * and the per-launch feasibility — here is what stops the second caller from growing a copy that
 * drifts.
 */

import { parseExecutionHostId } from './execution-host'
import type { GlobalSettings } from './global-settings-types'
import type { ProjectExecutionRuntimeResolution } from './project-execution-runtime'
import {
  STRUCTURED_AGENT_SESSION_CLIENT_LAUNCH_MODE_CAPABILITY,
  STRUCTURED_AGENT_SESSION_REGISTERED_AGENTS_RUNTIME_CAPABILITY,
  STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY
} from './protocol-version'
import type { TuiAgent } from './tui-agent'
import { isTuiAgent } from './tui-agent-config'
import type { WorkspaceLaunchKind } from './workspace-launch-kind'

export type NativeChatDefaultSettings = Pick<GlobalSettings, 'nativeChatProviders'>

/** Persist only explicit boolean choices for known agents; this map grants no runtime support. */
export function normalizeNativeChatProviders(value: unknown): Partial<Record<TuiAgent, boolean>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(value).filter(([agent, enabled]) => isTuiAgent(agent) && typeof enabled === 'boolean')
  )
}

/** Why a launch that the user's default asked to be structured cannot be. */
export type StructuredNativeChatBlocker =
  | 'reused-terminal'
  | 'agent-without-structured-session'
  | 'tui-launch-command'
  /** The launch names a start directory outside its workspace, which only a PTY can apply. The
   *  configured launch command and arguments never decide the surface. */
  | 'custom-start-directory'
  | 'remote-execution-host'
  | 'project-runtime'
  | 'runtime-capability'
  /** The owning host has not answered yet. Distinct from `runtime-capability`, which is the
   *  host saying no: an unestablished answer must not read as a refusal. */
  | 'runtime-capability-unknown'
  /** This client does not tell a paired host it can read and launch structured sessions. */
  | 'client-capability'

export type StructuredNativeChatSupport =
  | { supported: true }
  | { supported: false; blocker: StructuredNativeChatBlocker }

export type StructuredNativeChatSupportInput = {
  agent: TuiAgent
  executionHostId: string
  /** Capabilities of the host this launch would run on — a paired server's own, not this
   *  machine's. `null` = not yet established. */
  hostCapabilities: readonly string[] | null
  /** What this client advertises to a paired host; read only for `runtime:` hosts. */
  clientCapabilities?: readonly string[]
  /** Host-derived. Absent means the kind was never established, which is not evidence of any kind. */
  workspaceKind?: WorkspaceLaunchKind
  projectExecutionKind?: 'host' | 'ssh'
  projectRuntime?: ProjectExecutionRuntimeResolution | null
  startsOutsideWorkspaceRoot?: boolean
  /** A product caller requested an explicit terminal command or permission override. */
  requiresTuiLaunchCommand?: boolean
  /** An existing PTY agent keeps its execution transport. */
  reusesTerminal?: boolean
  /** The agents this exact host listed through `agentSession.agents`; absent is unknown. */
  hostStructuredAgents?: readonly string[]
}

/** The user's default view does not grant host support or restrict explicit Chat/history routes. */
export function isNativeChatDefaultFor(
  settings: Partial<NativeChatDefaultSettings> | null | undefined,
  agent: TuiAgent
): boolean {
  return settings?.nativeChatProviders?.[agent] !== false
}

function clientChoosesStructuredLaunches(capabilities: readonly string[] | undefined): boolean {
  return (
    capabilities?.includes(STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY) === true &&
    capabilities.includes(STRUCTURED_AGENT_SESSION_CLIENT_LAUNCH_MODE_CAPABILITY)
  )
}

export function resolveStructuredNativeChatSupport(
  input: StructuredNativeChatSupportInput
): StructuredNativeChatSupport {
  // Paired runtimes own their sessions; an SSH transport alone cannot establish a runtime.
  const host = parseExecutionHostId(input.executionHostId)
  if (input.projectExecutionKind === 'ssh' || (host?.kind !== 'local' && host?.kind !== 'runtime')) {
    return { supported: false, blocker: 'remote-execution-host' }
  }
  if (input.reusesTerminal === true) {
    return { supported: false, blocker: 'reused-terminal' }
  }
  if (input.startsOutsideWorkspaceRoot === true) {
    return { supported: false, blocker: 'custom-start-directory' }
  }
  if (input.requiresTuiLaunchCommand === true) {
    return { supported: false, blocker: 'tui-launch-command' }
  }
  const projectRuntime = input.projectRuntime
  if (projectRuntime?.status === 'repair-required' || projectRuntime?.runtime.kind === 'wsl') {
    return { supported: false, blocker: 'project-runtime' }
  }
  if (input.hostCapabilities === null) {
    return { supported: false, blocker: 'runtime-capability-unknown' }
  }
  if (input.hostStructuredAgents === undefined) {
    return { supported: false, blocker: 'runtime-capability-unknown' }
  }
  if (!input.hostStructuredAgents.includes(input.agent)) {
    return { supported: false, blocker: 'agent-without-structured-session' }
  }
  if (
    !input.hostCapabilities.includes(STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY) ||
    !input.hostCapabilities.includes(STRUCTURED_AGENT_SESSION_REGISTERED_AGENTS_RUNTIME_CAPABILITY)
  ) {
    return { supported: false, blocker: 'runtime-capability' }
  }
  if (host.kind === 'runtime') {
    // Both endpoints must advertise the current launch contract.
    if (!input.hostCapabilities.includes(STRUCTURED_AGENT_SESSION_CLIENT_LAUNCH_MODE_CAPABILITY)) {
      return { supported: false, blocker: 'runtime-capability' }
    }
    if (!clientChoosesStructuredLaunches(input.clientCapabilities)) {
      return { supported: false, blocker: 'client-capability' }
    }
  }
  return { supported: true }
}
