// Pure X-axis panel-width resolution for RightDrawer, kept native-import-free so
// it is unit-testable under the node Vitest config (no RN render harness exists).

// Graphite drawer contract: 80% on phones, capped at 400dp on larger canvases.
export const NARROW_PANEL_WIDTH_RATIO = 0.8
export const WIDE_PANEL_MAX_WIDTH = 400

export function resolveRightDrawerPanelWidth(
  windowWidth: number,
  isWideLayout: boolean,
  widthPx: number | undefined
): number {
  if (widthPx != null) {
    return Math.max(Math.min(widthPx, windowWidth, WIDE_PANEL_MAX_WIDTH), 0)
  }
  if (isWideLayout) {
    return Math.min(WIDE_PANEL_MAX_WIDTH, windowWidth)
  }
  return Math.max(Math.min(windowWidth * NARROW_PANEL_WIDTH_RATIO, WIDE_PANEL_MAX_WIDTH), 0)
}
