import { describe, expect, it } from 'vitest'
import type { AgentJournalRenderItem } from '../../../../shared/agent-session-journal-types'
import {
  AGENT_STATUS_STALE_AFTER_MS,
  type AgentStatusEntry
} from '../../../../shared/agent-status-types'
import { resolveSessionListStatus, type SessionListStatusInput } from './session-list-status'

const now = 2_000_000
const identity = {
  ownerBucketKey: 'ssh:alpha|folder-workspace',
  executionHostId: 'ssh:alpha' as const,
  tabId: 'terminal-1',
  paneKey: 'terminal-1:00000000-0000-4000-8000-000000000001',
  providerSessionId: 'provider-1'
}

function entry(patch: Partial<AgentStatusEntry> = {}): AgentStatusEntry {
  return {
    state: 'working',
    prompt: '',
    updatedAt: now - 10,
    stateStartedAt: now - 100,
    paneKey: identity.paneKey,
    tabId: identity.tabId,
    worktreeId: 'folder-workspace',
    providerSession: { key: 'session_id', id: identity.providerSessionId },
    stateHistory: [],
    observation: {
      origin: 'hook',
      kind: 'transition',
      authorityId: 'host-alpha',
      incarnation: 1,
      revision: 1,
      observedAt: now - 10
    },
    ...patch
  }
}

function input(patch: Partial<AgentStatusEntry> = {}): SessionListStatusInput {
  return {
    identity,
    now,
    connection: { identity, value: 'connected' },
    activity: { identity, value: { kind: 'hook', entry: entry(patch) } },
    execution: { identity, value: { verdict: 'live', reason: null } }
  }
}

function journal(body: AgentJournalRenderItem['body']): SessionListStatusInput {
  return {
    ...input(),
    activity: {
      identity,
      value: {
        kind: 'journal',
        receivedAt: now - 10,
        items: [{ itemId: 'item-1', revision: 1, sequence: 1, observedAt: now - 100, body }]
      }
    }
  }
}

describe('session list status from scoped evidence', () => {
  it('keeps live execution separate from missing activity', () => {
    expect(resolveSessionListStatus({ ...input(), activity: null })).toMatchObject({
      activity: 'unknown',
      lastActivityAt: null,
      execution: 'live'
    })
  })

  it.each(['Fix failed request', 'Review done logic', 'complete error handler'])(
    'ignores prose: %s',
    (terminalTitle) => {
      expect(resolveSessionListStatus(input({ terminalTitle })).activity).toBe('running')
      expect(
        resolveSessionListStatus({
          ...input(),
          activity: null,
          title: terminalTitle
        } as SessionListStatusInput).activity
      ).toBe('unknown')
    }
  )

  it.each(['waiting', 'blocked'] as const)(
    'does not turn ordinary %s into permission approval',
    (state) => {
      expect(
        resolveSessionListStatus(input({ state, interactivePrompt: '{"questions":[]}' })).activity
      ).toBe('waiting')
    }
  )

  it.each([
    { evidenceObservedAt: now - AGENT_STATUS_STALE_AFTER_MS - 1 },
    { restoredUnconfirmed: true },
    { updatedAt: Number.NaN },
    { evidenceObservedAt: now + 1 }
  ])('does not promote stale/unconfirmed/invalid evidence: %j', (patch) => {
    expect(resolveSessionListStatus(input(patch)).activity).toBe('unknown')
  })

  it('uses the replica receipt clock rather than a skewed remote wall clock', () => {
    expect(
      resolveSessionListStatus(
        input({
          evidenceObservedAt: now + 1_000_000,
          mirroredEvidenceReceivedAt: now - 10
        })
      ).activity
    ).toBe('running')
    expect(
      resolveSessionListStatus(
        input({
          updatedAt: now,
          mirroredEvidenceReceivedAt: now - AGENT_STATUS_STALE_AFTER_MS - 1
        })
      ).activity
    ).toBe('unknown')
  })

  it.each(['title', 'launch', 'process'] as const)(
    'does not label %s provenance as a hook activity fact',
    (origin) => {
      expect(
        resolveSessionListStatus(input({ observation: { ...entry().observation!, origin } }))
          .activity
      ).toBe('unknown')
    }
  )

  it('ignores unclassified and identity-only rows', () => {
    expect(resolveSessionListStatus(input({ observation: undefined })).activity).toBe('unknown')
    expect(
      resolveSessionListStatus(
        input({ observation: { ...entry().observation!, kind: 'identity-only' } })
      ).activity
    ).toBe('unknown')
  })

  it('requires positive completion and does not claim process exit from done', () => {
    expect(resolveSessionListStatus(input({ state: 'done' }))).toMatchObject({
      activity: 'completed',
      execution: 'live'
    })
    expect(resolveSessionListStatus(input({ state: 'done', interrupted: true })).activity).toBe(
      'unknown'
    )
    expect(resolveSessionListStatus(input({ state: 'done', sessionBoundary: true })).activity).toBe(
      'unknown'
    )
  })

  it('does not reorder a session on heartbeat or focus changes', () => {
    const initial = resolveSessionListStatus(input())
    const heartbeat = { ...input({ updatedAt: now }), lastFocusedAt: now }
    expect(resolveSessionListStatus(heartbeat).lastActivityAt).toBe(initial.lastActivityAt)
    expect(resolveSessionListStatus(input({ stateStartedAt: 0 })).lastActivityAt).toBeNull()
  })

  it.each(['disconnected', 'reconnecting', 'error', 'checking', 'runtime-unavailable'] as const)(
    'keeps %s transport separate from activity and process death',
    (value) => {
      expect(
        resolveSessionListStatus({ ...input(), connection: { identity, value } })
      ).toMatchObject({
        connection: value,
        activity: 'running',
        execution: 'unverifiable'
      })
    }
  )

  it('passes through the owning execution resolver verdict without inferring task success', () => {
    expect(
      resolveSessionListStatus({
        ...input(),
        execution: { identity, value: { verdict: 'exited', reason: 'host-confirmed exit' } }
      })
    ).toMatchObject({
      activity: 'running',
      execution: 'exited',
      executionReason: 'host-confirmed exit'
    })
  })

  it('separates identical tab and workspace ids on two hosts', () => {
    const other = {
      ...identity,
      executionHostId: 'ssh:beta' as const,
      ownerBucketKey: 'ssh:beta|folder-workspace'
    }
    expect(resolveSessionListStatus({ ...input(), identity: other })).toMatchObject({
      activity: 'unknown',
      execution: 'unverifiable',
      connection: 'unknown'
    })
    expect(
      resolveSessionListStatus({
        ...input(),
        identity: { ...identity, ownerBucketKey: 'folder-workspace' }
      }).activity
    ).toBe('unknown')
  })

  it.each([
    { tabId: 'terminal-2' },
    { paneKey: 'terminal-2:00000000-0000-4000-8000-000000000001' },
    { worktreeId: 'other-folder' },
    { worktreeId: 'ssh:beta|folder-workspace' },
    { providerSession: { key: 'session_id' as const, id: 'provider-2' } }
  ])('rejects another session inside a matched envelope: %j', (patch) => {
    expect(resolveSessionListStatus(input(patch)).activity).toBe('unknown')
  })

  it('uses explicit unresolved approval; a user question remains waiting', () => {
    const resolution = {
      state: 'pending' as const,
      selectedOptionId: null,
      resolvedBy: null,
      resolvedAt: null
    }
    expect(
      resolveSessionListStatus(
        journal({ kind: 'approval', title: 'Run command', detail: null, options: [], resolution })
      ).activity
    ).toBe('permission')
    expect(
      resolveSessionListStatus(
        journal({ kind: 'question', question: 'Choose branch', options: [], resolution })
      ).activity
    ).toBe('waiting')
    expect(
      resolveSessionListStatus(
        journal({
          kind: 'approval',
          title: 'Run command',
          detail: null,
          options: [],
          resolution: { ...resolution, state: 'cancelled' }
        })
      ).activity
    ).toBe('unknown')
  })

  it('projects active turns but does not infer success from prose or a settled lifecycle', () => {
    expect(
      resolveSessionListStatus(journal({ kind: 'status', text: 'done failed' })).activity
    ).toBe('unknown')
    expect(
      resolveSessionListStatus(
        journal({ kind: 'status', text: '', turnLifecycle: { turnId: 'turn-1', state: 'running' } })
      ).activity
    ).toBe('running')
    expect(
      resolveSessionListStatus(
        journal({
          kind: 'status',
          text: '',
          turnLifecycle: { turnId: 'turn-1', state: 'completed' }
        })
      ).activity
    ).toBe('unknown')
  })

  it('retains a real rejected-submission reason without declaring execution exited', () => {
    const state = journal({ kind: 'status', text: '' })
    if (state.activity!.value.kind !== 'journal') {
      throw new Error('Expected journal fixture')
    }
    state.activity!.value.latestSubmission = {
      clientMessageId: 'message-1',
      fence: 1,
      payloadFingerprint: 'fingerprint',
      dispatchState: 'rejected',
      providerItemId: null,
      reason: 'Provider rejected the request',
      submittedAt: now - 50,
      resolvedAt: now - 20
    }
    expect(resolveSessionListStatus(state)).toMatchObject({
      activity: 'error',
      reason: 'Provider rejected the request',
      execution: 'live'
    })
    state.activity!.value.receivedAt = now - AGENT_STATUS_STALE_AFTER_MS - 1
    expect(resolveSessionListStatus(state).activity).toBe('unknown')
  })
})
