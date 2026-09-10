import { useCallback, useLayoutEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { resolveCurrentSession, resolveSessionConnectionState } from '@/lib/session-navigation'
import { runtimeTargetForExecutionHostId } from '@/runtime/runtime-client-target'
import { requestBackgroundTerminalWorktreeMount } from '../terminal/background-terminal-worktree-mount'
import { setSessionPanelPortal } from '../activity/activity-terminal-portal'
import { sessionPanelAnchorName } from './session-detail-anchor'
import type { SessionListItem } from './session-list-types'

export default function SessionContent({
  item,
  groupId,
  isFocused = true,
  onFocus
}: {
  item: SessionListItem
  groupId?: string
  isFocused?: boolean
  onFocus?: () => void
}): React.JSX.Element {
  const slotId = groupId ? `session-detail:${groupId}` : 'session-detail'
  const onFocusRef = useRef(onFocus)
  onFocusRef.current = onFocus
  const focusPanel = useCallback(() => onFocusRef.current?.(), [])
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
  const setAnchor = useCallback(
    (node: HTMLDivElement | null) => {
      anchor.current = node
      if (!node) {
        setSessionPanelPortal(slotId, null)
      }
    },
    [slotId]
  )
  useLayoutEffect(() => {
    const target = anchor.current
    setSessionPanelPortal(
      slotId,
      target && !owner.error && owner.bucket && owner.tabId
        ? {
            slotId,
            requestToken: item.key,
            target,
            worktreeId: owner.bucket,
            tabId: owner.tabId,
            paneKey: item.paneKey ?? '',
            active: isFocused,
            onFocus: focusPanel
          }
        : null
    )
    if (!owner.error && owner.bucket && owner.tabId) {
      requestBackgroundTerminalWorktreeMount({ worktreeId: owner.bucket, tabIds: [owner.tabId] })
    }
  }, [
    owner.error,
    owner.bucket,
    owner.tabId,
    item.key,
    item.kind,
    item.paneKey,
    isFocused,
    slotId,
    focusPanel
  ])
  return (
    <div
      ref={setAnchor}
      className="session-chat-anchor"
      style={{ anchorName: sessionPanelAnchorName(groupId) } as React.CSSProperties}
      data-testid="session-chat-anchor"
      role="tabpanel"
      id={groupId ? `session-content-${groupId}` : 'session-content'}
      aria-labelledby={groupId ? `session-current-tab-${groupId}` : 'session-current-tab'}
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
