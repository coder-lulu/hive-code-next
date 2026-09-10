import { useCallback, useLayoutEffect, useState } from 'react'
import {
  useSensor,
  useSensors,
  type DragMoveEvent,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { TabDragPointerSensor } from '../tab-group/tab-drag-pointer-sensor'
import { TAB_DRAG_ACTIVATION_DISTANCE_PX } from '../tab-group/useTabDragSplit'
import { getDragPointer } from '../tab-group/tab-drag-pointer'
import { resolvePaneColumnEdgeZone } from '../tab-group/tab-drop-zone'
import type { TabDropZone } from '../tab-group/tab-drag-data'
import { installTabDragMissedEndListeners } from '../tab-group/tab-drag-missed-end-listeners'

type SessionDrop = { groupId: string; zone: TabDropZone; panelRect: DOMRect }
function resolveSessionDrop(event: DragMoveEvent | DragEndEvent): SessionDrop | null {
  const point = getDragPointer(event)
  if (!point) {
    return null
  }
  for (const panel of document.querySelectorAll<HTMLElement>('[data-session-panel]')) {
    const rect = panel.getBoundingClientRect()
    if (
      point.x < rect.left ||
      point.x > rect.right ||
      point.y < rect.top ||
      point.y > rect.bottom
    ) {
      continue
    }
    const bodyRect =
      panel.querySelector('[data-testid="session-chat-anchor"]')?.getBoundingClientRect() ?? null
    return {
      groupId: panel.dataset.sessionPanel!,
      panelRect: rect,
      zone: panel.dataset.sessionPanel
        ? (resolvePaneColumnEdgeZone(rect, point, { bodyRect }) ?? 'center')
        : 'center'
    }
  }
  return null
}

export function useSessionPanelDrag(
  onDrop: (key: string, groupId: string, zone: TabDropZone) => void
) {
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const [target, setTarget] = useState<SessionDrop | null>(null)
  const sensor = useSensor(TabDragPointerSensor, {
    activationConstraint: { distance: TAB_DRAG_ACTIVATION_DISTANCE_PX }
  })
  const sensors = useSensors(sensor)
  const cancel = useCallback((): void => {
    setActiveKey(null)
    setTarget(null)
    setPointer(null)
  }, [])
  useLayoutEffect(() => {
    if (!activeKey) {
      return
    }
    document.documentElement.dataset.sessionDragging = 'true'
    const release = installTabDragMissedEndListeners(cancel)
    return () => {
      release()
      delete document.documentElement.dataset.sessionDragging
    }
  }, [activeKey, cancel])
  return {
    activeKey,
    pointer,
    target,
    sensors,
    onDragStart: (event: DragStartEvent) => {
      const key = event.active.data.current?.sessionKey
      setActiveKey(typeof key === 'string' ? key : null)
      setPointer(getDragPointer({ ...event, delta: { x: 0, y: 0 } }))
    },
    onDragMove: (event: DragMoveEvent) => {
      setPointer(getDragPointer(event))
      setTarget(resolveSessionDrop(event))
    },
    onDragEnd: (event: DragEndEvent) => {
      const drop = resolveSessionDrop(event)
      const key = event.active.data.current?.sessionKey
      if (activeKey && drop && typeof key === 'string') {
        onDrop(key, drop.groupId, drop.zone)
      }
      cancel()
    },
    onDragCancel: cancel
  }
}
