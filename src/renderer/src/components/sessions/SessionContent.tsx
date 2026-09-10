import { useCallback, useLayoutEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { resolveCurrentSession, resolveSessionConnectionState } from '@/lib/session-navigation'
import { runtimeTargetForExecutionHostId } from '@/runtime/runtime-client-target'
import { requestBackgroundTerminalWorktreeMount } from '../terminal/background-terminal-worktree-mount'
import { setActivityTerminalPortals } from '../activity/activity-terminal-portal'
import { sessionDetailAnchorStyle } from './session-detail-anchor'
import type { SessionListItem } from './session-list-types'

export default function SessionContent({ item }: { item: SessionListItem }): React.JSX.Element {
  const anchor = useRef<HTMLDivElement | null>(null)
  const owner = useAppStore(
    useShallow((state) => {
      const resolved = resolveCurrentSession(state, item)
      if (resolved.error) {
        return { error: resolved.error, bucket: null, tabId: null }
      }
      if (
        item.kind === 'terminal' &&
        resolveSessionConnectionState(state, resolved.bucketKey, resolved.executionHostId) !==
          'connected'
      ) {
        return { error: 'disconnected', bucket: null, tabId: null }
      }
      if (
        item.kind === 'structured' &&
        !runtimeTargetForExecutionHostId(resolved.executionHostId)
      ) {
        return { error: 'unavailable', bucket: null, tabId: null }
      }
      return {
        error: null,
        bucket: resolved.bucketKey,
        tabId:
          item.kind === 'terminal' ? (resolved.terminal?.id ?? null) : (resolved.tab?.id ?? null)
      }
    })
  )
  const setAnchor = useCallback((node: HTMLDivElement | null) => {
    anchor.current = node
    if (!node) {
      setActivityTerminalPortals([])
    }
  }, [])
  useLayoutEffect(() => {
    const target = anchor.current
    setActivityTerminalPortals(
      target && !owner.error && owner.bucket && owner.tabId && item.kind === 'terminal'
        ? [
            {
              slotId: 'session-detail',
              requestToken: item.key,
              target,
              worktreeId: owner.bucket,
              tabId: owner.tabId,
              paneKey: item.paneKey ?? '',
              active: true
            }
          ]
        : []
    )
    if (!owner.error && owner.bucket && owner.tabId) {
      requestBackgroundTerminalWorktreeMount({ worktreeId: owner.bucket, tabIds: [owner.tabId] })
    }
  }, [owner.error, owner.bucket, owner.tabId, item.key, item.kind, item.paneKey])
  return (
    <div
      ref={setAnchor}
      className="session-chat-anchor"
      style={sessionDetailAnchorStyle}
      data-testid="session-chat-anchor"
      role="tabpanel"
      id="session-content"
      aria-labelledby="session-current-tab"
    >
      {owner.error && (
        <p className="session-availability-note" role="status">
          {owner.error === 'disconnected'
            ? translate(
                'components.sessions.openDisconnected',
                'Reconnect this host, then try opening the session again.'
              )
            : translate(
                'components.sessions.openUnavailable',
                'This session is no longer available in the current workspace. Refresh its host and try again.'
              )}
        </p>
      )}
    </div>
  )
}
