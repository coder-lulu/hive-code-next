import { expect, it } from 'vitest'
import type { AgentSessionStatusSummary } from './agent-session-wire'
import {
  foldAgentSessionStatusEvent,
  revokeAgentSessionStatusLive
} from './agent-session-status-snapshot-fold'

const summary: AgentSessionStatusSummary = {
  sessionId: 'a',
  workspaceId: 'folder',
  agent: 'codex',
  status: 'idle',
  latestPrompt: 'Continue',
  updatedAt: 1
}

it.each(['queued', 'starting', 'continued', 'refused', 'unconfirmed', 'skipped'] as const)(
  'folds %s progress and revokes it on contact loss, even without a provider child',
  (phase) => {
    const snapshot = foldAgentSessionStatusEvent(new Map(), {
      type: 'snapshot',
      sessions: [{ ...summary, restartResume: { phase } }]
    })
    expect(snapshot.get('a')?.restartResume?.phase).toBe(phase)
    const disconnected = revokeAgentSessionStatusLive(snapshot)
    expect(disconnected.get('a')).toEqual(summary)
    expect(revokeAgentSessionStatusLive(disconnected)).toBe(disconnected)
  }
)

it('a clearing frame removes progress rather than merging the previous optional field', () => {
  const snapshot = new Map([['a', { ...summary, restartResume: { phase: 'continued' as const } }]])
  expect(
    foldAgentSessionStatusEvent(snapshot, { type: 'status', session: summary }).get('a')
  ).toEqual(summary)
})

it.each([
  { hostExecutionPhase: 'starting' as const },
  { runtimePermission: { fence: 3, mode: 'full-access' } },
  { runtimePermission: null },
  { runtimePermission: undefined },
  { runtimePermission: 'unknown live payload' }
])('revokes isolated live evidence without changing durable history: %j', (live) => {
  const durable = { ...summary, permissionMode: 'own' as const, model: 'saved-model' }
  const original = { ...durable }
  for (const [key, value] of Object.entries(live)) Reflect.set(original, key, value)
  const snapshot = new Map([['a', original]])
  const revoked = revokeAgentSessionStatusLive(snapshot)
  expect(revoked.get('a')).toEqual(durable)
  expect(revoked.get('a')).not.toHaveProperty('runtimePermission')
  expect(snapshot.get('a')).toBe(original)
  expect(original).toStrictEqual({ ...durable, ...live })
  expect(revokeAgentSessionStatusLive(revoked)).toBe(revoked)
})

it('revokes only live rows while preserving untouched rows and the original snapshot', () => {
  const live = { ...summary, runtimePermission: { fence: 5, mode: 'full-access' } }
  const durable = { ...summary, sessionId: 'b', permissionMode: 'own' as const }
  const snapshot = new Map<string, AgentSessionStatusSummary>([
    ['a', live],
    ['b', durable]
  ])
  const revoked = revokeAgentSessionStatusLive(snapshot)
  expect(revoked.get('a')).toEqual(summary)
  expect(revoked.get('b')).toBe(durable)
  expect(snapshot.get('a')).toBe(live)
  expect(revokeAgentSessionStatusLive(revoked)).toBe(revoked)
})
