import { describe, expect, it } from 'vitest'
import { resolvePaneColumnEdgeZone } from './tab-drop-zone'

describe.each([32, 36, 48])('pane edges with a %ipx tab strip', (stripHeight) => {
  const panelRect = { left: 0, top: 20, width: 300, height: 200 }
  const bodyRect = { ...panelRect, top: panelRect.top + stripHeight, height: 200 - stripHeight }

  it('returns right on the outer horizontal band in the body', () => {
    expect(resolvePaneColumnEdgeZone(panelRect, { x: 260, y: 120 }, { bodyRect })).toBe('right')
  })

  it('returns null in the center band of the body', () => {
    expect(resolvePaneColumnEdgeZone(panelRect, { x: 150, y: 120 }, { bodyRect })).toBeNull()
  })

  it('does not return up while the pointer is still in the tab strip', () => {
    expect(
      resolvePaneColumnEdgeZone(
        panelRect,
        {
          x: 150,
          y: bodyRect.top - 1
        },
        { bodyRect }
      )
    ).toBeNull()
  })

  it('returns up on the top edge of the pane body', () => {
    expect(
      resolvePaneColumnEdgeZone(
        panelRect,
        {
          x: 150,
          y: bodyRect.top + 5
        },
        { bodyRect }
      )
    ).toBe('up')
  })

  it('does not guess a vertical edge without a measured body', () => {
    expect(resolvePaneColumnEdgeZone(panelRect, { x: 150, y: 60 }, { bodyRect: null })).toBeNull()
  })
})
