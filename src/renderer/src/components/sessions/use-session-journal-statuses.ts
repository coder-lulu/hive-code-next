import { useMemo, useSyncExternalStore } from 'react'
import { AGENT_STATUS_STALE_AFTER_MS } from '../../../../shared/agent-status-types'
import {
  runtimeTargetForExecutionHostId,
  type RuntimeClientTarget
} from '@/runtime/runtime-client-target'
import {
  getStructuredAgentSessionStatusFeed,
  type StructuredAgentSessionStatusFeedOwner
} from '@/runtime/structured-agent-session-status-feed'
import {
  getExistingStructuredAgentSessionReadOwner,
  subscribeStructuredAgentSessionReadSnapshots
} from '../native-chat/structured-agent-session-read-owner'
import { useAppStore } from '@/store'
import {
  isSessionActivityReceiptFresh,
  resolveSessionListStatus,
  type SessionListIdentity,
  type SessionListStatus
} from '../sidebar/session-list-status'
import { sessionStatusIdentity } from './session-list-model'
import type { SessionListItem } from './session-list-types'

type SessionSource = {
  sessionId: string
  identity: SessionListIdentity
  target: RuntimeClientTarget
  feed: StructuredAgentSessionStatusFeedOwner
}

function sameStatus(left: SessionListStatus, right: SessionListStatus): boolean {
  return (
    left.activity === right.activity &&
    left.reason === right.reason &&
    left.lastActivityAt === right.lastActivityAt &&
    left.connection === right.connection &&
    left.execution === right.execution &&
    left.executionReason === right.executionReason
  )
}

function sessionSources(items: readonly SessionListItem[]): Map<string, SessionSource> {
  const state = useAppStore.getState()
  const sources = new Map<string, SessionSource>()
  for (const item of items) {
    const identity = sessionStatusIdentity(item)
    if (item.kind !== 'structured' || !identity || !item.ownerBucketKey) {
      continue
    }
    const target = runtimeTargetForExecutionHostId(identity.executionHostId)
    const tabs =
      state.unifiedTabsByWorktree[item.ownerBucketKey]?.filter(
        (tab) => tab.id === item.unifiedTabId && tab.contentType === 'agent-session'
      ) ?? []
    if (!target || tabs.length !== 1) {
      continue
    }
    sources.set(item.key, {
      sessionId: tabs[0].entityId,
      identity,
      target,
      feed: getStructuredAgentSessionStatusFeed(target)
    })
  }
  return sources
}

function projectSessionStatus(item: SessionListItem, source: SessionSource, now: number) {
  const { identity, sessionId, target, feed } = source
  const journal = getExistingStructuredAgentSessionReadOwner(sessionId, target)?.getSnapshot()
  const summary = feed.getEvidenceSnapshot().get(sessionId)
  const base = {
    identity,
    now,
    connection: { identity, value: item.status.connection },
    execution: null
  }
  const providerMatches =
    identity.providerSessionId === null ||
    journal?.providerSession?.id === identity.providerSessionId
  const journalStatus =
    journal?.receivedAt && providerMatches
      ? resolveSessionListStatus({
          ...base,
          activity: {
            identity,
            value: {
              kind: 'journal',
              receivedAt: journal.receivedAt,
              items: journal.state.items,
              latestSubmission: journal.state.submissions.at(-1)
            }
          }
        })
      : null
  const status =
    journalStatus &&
    journal?.state.status === 'ready' &&
    isSessionActivityReceiptFresh(journal.receivedAt, now)
      ? journalStatus
      : summary
        ? resolveSessionListStatus({
            ...base,
            activity: {
              identity,
              value: {
                kind: 'summary',
                sessionId,
                ...summary
              }
            }
          })
        : resolveSessionListStatus({ ...base, activity: null })
  return {
    status,
    lastActivityAt: Math.max(
      item.lastActivityAt,
      status.lastActivityAt ?? 0,
      journalStatus?.lastActivityAt ?? 0
    )
  }
}

function createSessionStatusProjection(items: readonly SessionListItem[]) {
  const sources = sessionSources(items)
  const feeds = new Set([...sources.values()].map((source) => source.feed))
  let snapshot = items
  const project = (): void => {
    const now = Date.now()
    let changed = false
    const next = items.map((item, index) => {
      const source = sources.get(item.key)
      if (!source) {
        return item
      }
      const projected = projectSessionStatus(item, source, now)
      const previous = snapshot[index]
      const lastActivityAt = Math.max(projected.lastActivityAt, previous.lastActivityAt)
      if (
        sameStatus(previous.status, projected.status) &&
        previous.lastActivityAt === lastActivityAt
      ) {
        return previous
      }
      changed = true
      return { ...item, ...projected, lastActivityAt }
    })
    if (changed) {
      snapshot = next
    }
  }
  project()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void): (() => void) => {
      let timer: ReturnType<typeof setTimeout> | null = null
      let disposed = false
      const update = (): void => {
        if (disposed) {
          return
        }
        if (timer !== null) {
          clearTimeout(timer)
        }
        const previous = snapshot
        project()
        const now = Date.now()
        let nextExpiry = Number.POSITIVE_INFINITY
        for (const { sessionId, target, feed } of sources.values()) {
          const journal = getExistingStructuredAgentSessionReadOwner(
            sessionId,
            target
          )?.getSnapshot()
          const summary = feed.getEvidenceSnapshot().get(sessionId)
          for (const receivedAt of [journal?.receivedAt, summary?.receivedAt]) {
            if (
              receivedAt !== undefined &&
              receivedAt !== null &&
              isSessionActivityReceiptFresh(receivedAt, now)
            ) {
              nextExpiry = Math.min(nextExpiry, receivedAt + AGENT_STATUS_STALE_AFTER_MS + 1)
            }
          }
        }
        timer = Number.isFinite(nextExpiry) ? setTimeout(update, nextExpiry - now) : null
        if (snapshot !== previous) {
          listener()
        }
      }
      // The existing chat/host bridge owns activation; list projection owns no remote lifecycle.
      const unsubscribes = [
        subscribeStructuredAgentSessionReadSnapshots(update),
        ...[...feeds].map((feed) => feed.subscribe(update))
      ]
      update()
      return () => {
        disposed = true
        if (timer !== null) {
          clearTimeout(timer)
        }
        for (const unsubscribe of unsubscribes) {
          unsubscribe()
        }
      }
    }
  }
}

export function useSessionJournalStatuses(
  items: readonly SessionListItem[]
): readonly SessionListItem[] {
  const projection = useMemo(() => createSessionStatusProjection(items), [items])
  return useSyncExternalStore(projection.subscribe, projection.getSnapshot, projection.getSnapshot)
}
