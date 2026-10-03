import { useCallback, useRef, useState } from 'react'
import { useSidebarResize } from '@/hooks/useSidebarResize'

export function useNavigationPaneResize(storageKey: string, label: string, defaultWidth = 320) {
  const collapsedStorageKey = storageKey.replace(/-width$/, '-collapsed')
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(collapsedStorageKey) === 'true'
    } catch {
      return false
    }
  })
  const toggleCollapsed = (): void => {
    const next = !collapsed
    setCollapsed(next)
    try {
      localStorage.setItem(collapsedStorageKey, String(next))
    } catch {
      /* Storage can be unavailable. */
    }
  }
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey))
      return Number.isFinite(saved) && saved >= 240 ? Math.min(520, saved) : defaultWidth
    } catch {
      return defaultWidth
    }
  })
  const saveWidth = useCallback(
    (next: number) => {
      const bounded = Math.min(520, Math.max(240, next))
      setWidth(bounded)
      try {
        localStorage.setItem(storageKey, String(bounded))
      } catch {
        /* Storage can be unavailable. */
      }
    },
    [storageKey]
  )
  const { containerRef, onResizeStart } = useSidebarResize<HTMLElement>({
    isOpen: !collapsed,
    width,
    minWidth: 240,
    maxWidth: 520,
    deltaSign: 1,
    setWidth: saveWidth
  })
  const lastResizePress = useRef({ time: 0, x: 0 })
  return {
    containerRef,
    collapsed,
    toggleCollapsed,
    resizeHandle: collapsed ? null : (
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuemin={240}
        aria-valuemax={520}
        aria-valuenow={width}
        tabIndex={0}
        className="navigation-pane-resize-handle"
        onMouseDown={(event) => {
          if (event.button !== 0) {
            return
          }
          const now = performance.now()
          const previous = lastResizePress.current
          lastResizePress.current = { time: now, x: event.clientX }
          // The resize overlay receives mouseup, so native dblclick targets differ.
          if (
            previous.time > 0 &&
            now - previous.time < 350 &&
            Math.abs(previous.x - event.clientX) < 4
          ) {
            event.preventDefault()
            saveWidth(defaultWidth)
          } else {
            onResizeStart(event)
          }
        }}
        onDoubleClick={() => saveWidth(defaultWidth)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault()
            saveWidth(width + (event.key === 'ArrowRight' ? 16 : -16))
          } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault()
            saveWidth(event.key === 'Home' ? 240 : 520)
          }
        }}
      />
    )
  }
}
