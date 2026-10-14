import type { AgentSessionStoreState } from './agent-session-store-contract'
export type {
  AgentSessionStoreState,
  RetiredAgentSessionClaimKey
} from './agent-session-store-contract'

/** Every session id the state holds a row for, readable or not. */
export function heldAgentSessionIds(state: AgentSessionStoreState): string[] {
  return [...state.records.keys(), ...state.unreadableRecords.keys()]
}
