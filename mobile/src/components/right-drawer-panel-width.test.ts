import { describe, expect, it } from 'vitest'
import {
  resolveRightDrawerPanelWidth,
  WIDE_PANEL_MAX_WIDTH,
  NARROW_PANEL_WIDTH_RATIO
} from './right-drawer-panel-width'

describe('resolveRightDrawerPanelWidth', () => {
  it('caps to the wide max width on wide layouts', () => {
    expect(resolveRightDrawerPanelWidth(1024, true, undefined)).toBe(WIDE_PANEL_MAX_WIDTH)
  })

  it('uses the Graphite 80% width on narrow layouts', () => {
    expect(resolveRightDrawerPanelWidth(400, false, undefined)).toBe(400 * NARROW_PANEL_WIDTH_RATIO)
  })

  it('honors an explicit widthPx but never exceeds the window width', () => {
    expect(resolveRightDrawerPanelWidth(1024, true, 320)).toBe(320)
    expect(resolveRightDrawerPanelWidth(280, false, 320)).toBe(280)
    expect(resolveRightDrawerPanelWidth(1024, true, 480)).toBe(WIDE_PANEL_MAX_WIDTH)
  })

  it('never returns a negative width on tiny windows', () => {
    expect(resolveRightDrawerPanelWidth(20, false, undefined)).toBe(16)
  })

  it('clamps a negative explicit widthPx to zero', () => {
    expect(resolveRightDrawerPanelWidth(400, false, -10)).toBe(0)
  })
})
