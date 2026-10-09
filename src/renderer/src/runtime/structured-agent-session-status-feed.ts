// One host status stream per runtime target, shared by every session-list projection.
//
// The feed is a read-only mirror: the host projects each session's status from its journal and
// this owner keeps the latest summary per session while anyone is looking. Losing the stream
// keeps the cached summaries and reconnects; a fresh snapshot merges over them.
// Which sessions are listed is the tab map's decision, so the feed never retracts a summary.

import type {
  AgentSessionStatusEvent,
  AgentSessionStatusSummary
} from '../../../shared/agent-session-wire'
import {
  foldAgentSessionStatusEvent,
  revokeAgentSessionStatusLive,
  type AgentSessionStatusSnapshot
} from '../../../shared/agent-session-status-snapshot-fold'
import { AGENT_SESSION_STATUS_FEED_RUNTIME_CAPABILITY } from '../../../shared/protocol-version'
import {
  runtimeEnvironmentSupportsCapability,
  type RuntimeClientTarget
} from './runtime-rpc-client'
import { subscribeStructuredAgentSessionStatus } from './structured-agent-session-client'

export type StructuredAgentSessionStatusSnapshot = AgentSessionStatusSnapshot
export type StructuredAgentSessionStatusEvidence = {
  summary: AgentSessionStatusSummary
  receivedAt: number
}

export type StructuredAgentSessionStatusFeedOwner = {
  activate: () => () => void
  getSnapshot: () => StructuredAgentSessionStatusSnapshot
  getEvidenceSnapshot: () => ReadonlyMap<string, StructuredAgentSessionStatusEvidence>
  getSessionObservation: (sessionId: string) => 'live' | 'unverifiable'
  subscribe: (listener: () => void) => () => void
}

const RECONNECT_MAX_DELAY_MS = 5_000

/** `stop` is the map's own teardown, not part of the owner contract callers hold. */
type OwnedStatusFeed = StructuredAgentSessionStatusFeedOwner & { stop: () => void }

const owners = new Map<string, OwnedStatusFeed>()

export function structuredAgentSessionStatusFeedKey(target: RuntimeClientTarget): string {
  return target.kind === 'local' ? 'local' : `environment:${target.environmentId}`
}

function createOwner(target: RuntimeClientTarget): OwnedStatusFeed {
  let snapshot: StructuredAgentSessionStatusSnapshot = new Map()
  let evidenceSnapshot: ReadonlyMap<string, StructuredAgentSessionStatusEvidence> = new Map()
  const confirmedSessions = new Set<string>()
  const listeners = new Set<() => void>()
  const activations = new Set<symbol>()
  let generation = 0
  let handle: { unsubscribe: () => void } | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempt = 0

  const emit = (): void => {
    for (const listener of listeners) {
      listener()
    }
  }
  const applyEvent = (event: AgentSessionStatusEvent): void => {
    if (event.type === 'end') {
      return
    }
    if (event.type === 'snapshot') {
      reconnectAttempt = 0
    }
    const sessions = event.type === 'snapshot' ? event.sessions : [event.session]
    if (sessions.length === 0) {
      return
    }
    // An empty restart snapshot neither retracts cached rows nor renews their receipt.
    const next = foldAgentSessionStatusEvent(snapshot, event)
    const nextEvidence = new Map(evidenceSnapshot)
    const receivedAt = Date.now()
    for (const session of sessions) {
      confirmedSessions.add(session.sessionId)
      nextEvidence.set(session.sessionId, { summary: session, receivedAt })
    }
    snapshot = next
    evidenceSnapshot = nextEvidence
    emit()
  }
  const active = (candidate: number): boolean => activations.size > 0 && candidate === generation
  const clearReconnect = (): void => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }
  const dropHandle = (): void => {
    handle?.unsubscribe()
    handle = null
  }
  const revokeSnapshotOwnership = (): void => {
    const next = revokeAgentSessionStatusLive(snapshot)
    if (next !== snapshot) {
      snapshot = next
      const nextEvidence = new Map(evidenceSnapshot)
      for (const [sessionId, evidence] of evidenceSnapshot) {
        const summary = next.get(sessionId)
        if (summary && summary !== evidence.summary) {
          nextEvidence.set(sessionId, { ...evidence, summary })
        }
      }
      evidenceSnapshot = nextEvidence
      emit()
    }
  }
  let open = (): void => {}
  const scheduleReconnect = (candidate: number): void => {
    if (!active(candidate) || reconnectTimer) {
      return
    }
    const delay = Math.min(250 * 2 ** reconnectAttempt, RECONNECT_MAX_DELAY_MS)
    reconnectAttempt += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      if (active(candidate)) {
        open()
      }
    }, delay)
  }
  // Losing contact is never exit: the sessions go unverifiable and this client stops
  // claiming host-owned execution, but nothing here settles them.
  const loseConnection = (candidate: number): void => {
    if (candidate !== generation) {
      return
    }
    generation += 1
    confirmedSessions.clear()
    revokeSnapshotOwnership()
    emit()
    dropHandle()
    scheduleReconnect(generation)
  }
  const subscribeToHost = (candidate: number): void => {
    void subscribeStructuredAgentSessionStatus(
      target,
      (event) => {
        if (!active(candidate)) {
          return
        }
        if (event.type === 'end') {
          loseConnection(candidate)
          return
        }
        applyEvent(event)
      },
      () => {
        if (active(candidate)) {
          loseConnection(candidate)
        }
      },
      () => {
        if (active(candidate)) {
          loseConnection(candidate)
        }
      }
    )
      .then((opened) => {
        if (active(candidate)) {
          handle = opened
        } else {
          opened.unsubscribe()
        }
      })
      .catch(() => loseConnection(candidate))
  }
  open = (): void => {
    const candidate = ++generation
    dropHandle()
    if (target.kind !== 'environment') {
      // A local host is this build; only a remote one can predate the method.
      subscribeToHost(candidate)
      return
    }
    const environmentId = target.environmentId
    void runtimeEnvironmentSupportsCapability(
      environmentId,
      AGENT_SESSION_STATUS_FEED_RUNTIME_CAPABILITY
    )
      .then((supported) => {
        if (!active(candidate)) {
          return
        }
        // A host without the method is terminal, not a fault: retrying would relay-probe
        // forever. A failed probe is not an answer, so that path still reconnects.
        if (supported) {
          subscribeToHost(candidate)
          return
        }
        console.warn('[structured-session-status] host too old for the status feed', environmentId)
      })
      .catch(() => loseConnection(candidate))
  }
  const stop = (): void => {
    generation += 1
    clearReconnect()
    dropHandle()
    revokeSnapshotOwnership()
    reconnectAttempt = 0
    // Teardown only runs once nothing is activated, so re-confirmation is the next
    // subscribe's job and there is no mounted reader left to notify.
    confirmedSessions.clear()
  }

  return {
    activate: () => {
      const token = Symbol('status-feed')
      activations.add(token)
      if (activations.size === 1) {
        open()
      }
      return () => {
        activations.delete(token)
        if (activations.size === 0) {
          stop()
        }
      }
    },
    getSnapshot: () => snapshot,
    getEvidenceSnapshot: () => evidenceSnapshot,
    getSessionObservation: (sessionId) =>
      confirmedSessions.has(sessionId) ? 'live' : 'unverifiable',
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    stop
  }
}

export function getStructuredAgentSessionStatusFeed(
  target: RuntimeClientTarget
): StructuredAgentSessionStatusFeedOwner {
  const key = structuredAgentSessionStatusFeedKey(target)
  let owner = owners.get(key)
  if (!owner) {
    owner = createOwner(target)
    owners.set(key, owner)
  }
  return owner
}

export function resetStructuredAgentSessionStatusFeedsForTests(): void {
  // Dropping the map alone leaves a live subscription and its pending reconnect running
  // into the next test, where they reopen a stream nothing is holding.
  for (const owner of owners.values()) {
    owner.stop()
  }
  owners.clear()
}
