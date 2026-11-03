import { resolveAgentPermission, type AgentPermissionSettings } from './tui-agent-permission-choice'
import { isTuiAgent } from './tui-agent-config'
import {
  agentChatPermissionModes,
  type AgentChatPermissionModeSupport
} from './agent-chat-permission-support'

/** A chat's own permission choice. Saved in chat records and settings: never rename a value. */
export type AgentChatPermissionChoice = 'own' | AgentChatPermissionMode

export type AgentChatPermissionMode = 'ask' | 'accept-edits' | 'auto' | 'full-access'

export function isAgentChatPermissionChoice(value: unknown): value is AgentChatPermissionChoice {
  return value === 'own' || isAgentChatPermissionMode(value)
}

/** Picker order: least to most access. */
export const AGENT_CHAT_PERMISSION_MODES = [
  'ask',
  'accept-edits',
  'auto',
  'full-access'
] as const satisfies readonly AgentChatPermissionMode[]

/** Desktop/mobile resolve these lucide names through their own icon packages. */
export const AGENT_CHAT_PERMISSION_MODE_ICON_NAMES = {
  ask: 'Hand',
  'accept-edits': 'FilePenLine',
  auto: 'ShieldCheck',
  'full-access': 'ShieldAlert'
} as const satisfies Record<AgentChatPermissionMode, string>

export type AgentChatPermissionModeIconName =
  (typeof AGENT_CHAT_PERMISSION_MODE_ICON_NAMES)[AgentChatPermissionMode]

export const AGENT_CHAT_PERMISSION_MODE_OPTION_ID = 'permissionMode'

export function isAgentChatPermissionMode(value: unknown): value is AgentChatPermissionMode {
  return AGENT_CHAT_PERMISSION_MODES.some((mode) => mode === value)
}

export {
  agentChatPermissionModes,
  type AgentChatPermissionModeSupport
} from './agent-chat-permission-support'

/** The saved choice if this agent offers it; anything else asks, never grants more access. */
export function savedChatPermissionMode(
  support: AgentChatPermissionModeSupport,
  intent: AgentChatPermissionMode
): AgentChatPermissionMode

export function savedChatPermissionMode(
  support: AgentChatPermissionModeSupport,
  intent: unknown
): AgentChatPermissionChoice

export function savedChatPermissionMode(
  support: AgentChatPermissionModeSupport,
  intent: unknown
): AgentChatPermissionChoice {
  if (intent === 'own') {
    return 'own'
  }
  return support.modes.find((mode) => mode === intent) ?? 'ask'
}

export function newChatPermissionMode(
  agent: string,
  setting: unknown
): AgentChatPermissionChoice | null {
  const support = agentChatPermissionModes(agent)
  return support ? savedChatPermissionMode(support, setting) : null
}
export type NewChatPermissionSettings = AgentPermissionSettings

export function newChatPermissionModeForSettings(
  agent: string,
  settings: NewChatPermissionSettings | null | undefined
): AgentChatPermissionChoice | null {
  const support = agentChatPermissionModes(agent)
  return support && isTuiAgent(agent)
    ? savedChatPermissionMode(support, resolveAgentPermission(agent, settings).choice)
    : null
}

/** The one rule for whether the chat's model runs `auto`: its listed row, or the listed CLI default
 *  when it names none. The host launches with it and the menu offers with it. */
export function chatModelSupportsAutoMode(
  models: readonly { id: string; isDefault?: boolean; supportsAutoMode?: boolean }[],
  model: string | null | undefined
): boolean {
  const row = models.find((entry) =>
    model === undefined || model === null || model === 'default'
      ? entry.isDefault === true
      : entry.id === model
  )
  return row?.supportsAutoMode === true
}

/** Whether the mode a chat runs depends on its model's listed `auto` support. */
export function chatPermissionModeNeedsModelSupport(
  support: AgentChatPermissionModeSupport,
  intent: unknown
): boolean {
  return (
    support.autoNeedsModelSupport === true && savedChatPermissionMode(support, intent) === 'auto'
  )
}

/** Saved choice, with `auto` on a model not listed for it read as Ask; never written back. */
export function effectiveChatPermissionMode(
  support: AgentChatPermissionModeSupport,
  intent: unknown,
  autoSupported: boolean
): AgentChatPermissionChoice {
  const mode = savedChatPermissionMode(support, intent)
  return mode === 'auto' && support.autoNeedsModelSupport && !autoSupported ? 'ask' : mode
}

export function offeredChatPermissionModes(
  support: AgentChatPermissionModeSupport,
  autoSupported: boolean
): readonly AgentChatPermissionMode[] {
  return support.autoNeedsModelSupport && !autoSupported
    ? support.modes.filter((mode) => mode !== 'auto')
    : support.modes
}
