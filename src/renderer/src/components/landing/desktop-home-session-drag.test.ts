import { describe, expect, it } from 'vitest'
import {
  DESKTOP_HOME_SESSION_DRAG_MIME,
  readDesktopHomeSessionDragData,
  writeDesktopHomeSessionDragData
} from './desktop-home-session-drag'

function dataTransfer(): DataTransfer {
  const values = new Map<string, string>()
  return {
    effectAllowed: 'none',
    setData: (type: string, value: string) => values.set(type, value),
    getData: (type: string) => values.get(type) ?? ''
  } as unknown as DataTransfer
}

describe('desktop home temporary-session drag payload', () => {
  it('round-trips a session identity and title', () => {
    const transfer = dataTransfer()
    writeDesktopHomeSessionDragData(transfer, {
      sessionId: 'session-1',
      tabId: 'tab-1',
      title: 'Review API',
      executionHostId: 'runtime:cloud-1'
    })

    expect(transfer.effectAllowed).toBe('move')
    expect(readDesktopHomeSessionDragData(transfer)).toEqual({
      sessionId: 'session-1',
      tabId: 'tab-1',
      title: 'Review API',
      executionHostId: 'runtime:cloud-1'
    })
  })

  it('rejects malformed or incomplete custom payloads', () => {
    const transfer = dataTransfer()
    transfer.setData(DESKTOP_HOME_SESSION_DRAG_MIME, '{"sessionId":""}')
    expect(readDesktopHomeSessionDragData(transfer)).toBeNull()

    transfer.setData(DESKTOP_HOME_SESSION_DRAG_MIME, 'not-json')
    expect(readDesktopHomeSessionDragData(transfer)).toBeNull()
  })
})
