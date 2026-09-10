import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { SessionListItem } from './session-list-types'
import {
  closeSessionPanelTab,
  EMPTY_SESSION_PANELS,
  openSessionPanelTab,
  resizeSessionPanel,
  syncSessionPanelCollection
} from './session-panel-layout'
import type { TabDropZone } from '../tab-group/tab-drag-data'

export function useSessionPanels(
  items: readonly SessionListItem[],
  selectedKey: string | null,
  select: (key: string | null) => void,
  collectionKey?: string
) {
  const [panels, setPanels] = useState(EMPTY_SESSION_PANELS)
  const collection = useRef<{ key: string | undefined; closed: Set<string> }>({
    key: undefined,
    closed: new Set()
  })
  useLayoutEffect(() => {
    if (collectionKey === undefined) {
      collection.current.key = undefined
      return
    }
    const changed = collection.current.key !== collectionKey
    if (changed) {
      collection.current = { key: collectionKey, closed: new Set() }
    }
    const next = syncSessionPanelCollection(
      changed ? EMPTY_SESSION_PANELS : panels,
      items.map((item) => item.key),
      selectedKey,
      collection.current.closed,
      crypto.randomUUID()
    )
    if (next !== panels) {
      setPanels(next)
    }
    const activeKey =
      next.groups.find((group) => group.id === next.focusedGroupId)?.activeKey ?? null
    if (selectedKey !== activeKey) {
      select(activeKey)
    }
  }, [collectionKey, items, panels, selectedKey, select])
  useLayoutEffect(() => {
    if (
      collectionKey !== undefined ||
      !selectedKey ||
      !items.some((item) => item.key === selectedKey)
    ) {
      return
    }
    setPanels((state) =>
      openSessionPanelTab(state, selectedKey, { newGroupId: crypto.randomUUID() })
    )
  }, [selectedKey, items, collectionKey])
  useLayoutEffect(() => {
    if (collectionKey !== undefined) {
      return
    }
    const valid = new Set(items.map((item) => item.key))
    const removed = panels.groups.flatMap((group) => group.keys).filter((key) => !valid.has(key))
    if (!removed.length) {
      return
    }
    const next = removed.reduce(closeSessionPanelTab, panels)
    setPanels(next)
    if (selectedKey && removed.includes(selectedKey)) {
      select(next.groups.find((group) => group.id === next.focusedGroupId)?.activeKey ?? null)
    }
  }, [items, panels, selectedKey, select, collectionKey])
  const open = useCallback(
    (key: string, groupId?: string, zone?: TabDropZone) => {
      if (!items.some((item) => item.key === key)) {
        return
      }
      collection.current.closed.delete(key)
      setPanels((state) =>
        openSessionPanelTab(state, key, {
          groupId,
          zone,
          append:
            Boolean(groupId) ||
            (collectionKey !== undefined &&
              !state.groups.some((group) => group.keys.includes(key))),
          newGroupId: crypto.randomUUID()
        })
      )
      select(key)
    },
    [items, select, collectionKey]
  )
  const close = (key: string): void => {
    if (collectionKey !== undefined) {
      collection.current.closed.add(key)
    }
    const next = closeSessionPanelTab(panels, key)
    setPanels(next)
    if (key === selectedKey) {
      select(next.groups.find((group) => group.id === next.focusedGroupId)?.activeKey ?? null)
    }
  }
  const focus = (groupId: string): void => {
    const group = panels.groups.find((candidate) => candidate.id === groupId)
    if (!group || (panels.focusedGroupId === groupId && selectedKey === group.activeKey)) {
      return
    }
    setPanels((state) => ({ ...state, focusedGroupId: groupId }))
    select(group.activeKey)
  }
  return {
    panels,
    reopenAll: () => {
      collection.current.closed.clear()
      setPanels({ ...EMPTY_SESSION_PANELS })
    },
    open,
    close,
    focus,
    resize: (path: string, ratio: number) =>
      setPanels((state) => resizeSessionPanel(state, path, ratio))
  }
}
