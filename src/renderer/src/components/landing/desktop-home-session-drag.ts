import type { ExecutionHostId } from '../../../../shared/execution-host'

/**
 * Narrow drag payload shared by the temporary-session rows and the home
 * project tree. The project assignment is persisted on the existing session;
 * the live PTY keeps its original owner and is never duplicated by the gesture.
 */
export const DESKTOP_HOME_SESSION_DRAG_MIME = 'application/x-hivecode-temporary-session'

export type DesktopHomeSessionDragPayload = {
  sessionId: string
  tabId?: string
  title: string
  /** Optional host provenance prevents duplicate provider ids crossing runtimes. */
  executionHostId?: ExecutionHostId
}

export function writeDesktopHomeSessionDragData(
  dataTransfer: DataTransfer,
  payload: DesktopHomeSessionDragPayload
): void {
  const serialized = JSON.stringify(payload)
  dataTransfer.effectAllowed = 'move'
  dataTransfer.setData(DESKTOP_HOME_SESSION_DRAG_MIME, serialized)
  // Keep a useful native fallback for platforms that do not expose custom
  // MIME data to a drop target in another renderer surface.
  dataTransfer.setData('text/plain', payload.title)
}

/**
 * Drag data is protected during `dragover` in Chromium, so `getData()` may
 * return an empty string until the actual `drop` event. Use the advertised
 * MIME type for hit-testing/highlighting and parse the payload only on drop.
 */
export function hasDesktopHomeSessionDragData(
  dataTransfer: DataTransfer | null | undefined
): boolean {
  if (!dataTransfer) {
    return false
  }
  return Array.from(dataTransfer.types ?? []).includes(DESKTOP_HOME_SESSION_DRAG_MIME)
}

export function readDesktopHomeSessionDragData(
  dataTransfer: DataTransfer | null | undefined
): DesktopHomeSessionDragPayload | null {
  if (!dataTransfer) {
    return null
  }
  let raw: string
  try {
    raw = dataTransfer.getData(DESKTOP_HOME_SESSION_DRAG_MIME)
  } catch {
    return null
  }
  if (!raw) {
    return null
  }
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') {
      return null
    }
    const candidate = value as Partial<DesktopHomeSessionDragPayload>
    if (
      typeof candidate.sessionId !== 'string' ||
      candidate.sessionId.trim().length === 0 ||
      typeof candidate.title !== 'string' ||
      candidate.title.trim().length === 0
    ) {
      return null
    }
    return {
      sessionId: candidate.sessionId,
      ...(typeof candidate.tabId === 'string' && candidate.tabId.trim()
        ? { tabId: candidate.tabId }
        : {}),
      title: candidate.title,
      ...(typeof candidate.executionHostId === 'string' && candidate.executionHostId.trim()
        ? { executionHostId: candidate.executionHostId }
        : {})
    }
  } catch {
    return null
  }
}
