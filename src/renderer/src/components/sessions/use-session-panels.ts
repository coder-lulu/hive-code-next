import { useCallback, useLayoutEffect, useState } from 'react'
import type { SessionListItem } from './session-list-types'
import {
  closeSessionPanelTab,
  EMPTY_SESSION_PANELS,
  openSessionPanelTab,
  resizeSessionPanel
} from './session-panel-layout'
import type { TabDropZone } from '../tab-group/tab-drag-data'

export function useSessionPanels(
  items: readonly SessionListItem[],
  selectedKey: string | null,
  select: (key: string | null) => void
) {
  const [panels, setPanels] = useState(EMPTY_SESSION_PANELS)
  useLayoutEffect(() => {
    if (!selectedKey || !items.some((item) => item.key === selectedKey)) {
      return
    }
    setPanels((state) =>
      openSessionPanelTab(state, selectedKey, { newGroupId: crypto.randomUUID() })
    )
  }, [selectedKey, items])
  useLayoutEffect(() => {
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
  }, [items, panels, selectedKey, select])
  const open = useCallback(
    (key: string, groupId?: string, zone?: TabDropZone) => {
      if (!items.some((item) => item.key === key)) {
        return
      }
      setPanels((state) =>
        openSessionPanelTab(state, key, {
          groupId,
          zone,
          append: Boolean(groupId),
          newGroupId: crypto.randomUUID()
        })
      )
      select(key)
    },
    [items, select]
  )
  const close = (key: string): void => {
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
    open,
    close,
    focus,
    resize: (path: string, ratio: number) =>
      setPanels((state) => resizeSessionPanel(state, path, ratio))
  }
}
