import { describe, expect, it, vi } from 'vitest'
import { cellToViewportPx } from './cell-geometry'
import { createTerminalDocumentScope } from './document-scope'
import { terminalDocumentDouble } from './document-terminal-double.test-support'
import { getCellHeight } from './fit-scale'
import { viewportToMouseReportCell } from './mouse-report-cell'
import { applyXtermSelection, selRange } from './selection-range'
import { viewportToCell } from './viewport-cell'
import { getCellWidth, getTotalScale } from './viewport-transform'

function measuredScope() {
  const scope = createTerminalDocumentScope()
  const terminal = terminalDocumentDouble().terminal
  scope.viewportRect = () => ({ left: 0, top: 0, width: 640, height: 480 })
  const select = vi.fn()
  scope.term = {
    ...terminal,
    _core: { _renderService: { dimensions: { css: { cell: { width: 8, height: 17 } } } } },
    buffer: { active: { ...terminal.buffer.active, viewportY: 5 } },
    select
  }
  scope.currentScale = 0.75
  scope.userScale = 2
  scope.panX = 10
  scope.panY = 20
  return { scope, select }
}

describe('terminal document cell metrics and selection', () => {
  it('keeps safe cell measurement fallbacks before xterm has a renderer', () => {
    const scope = createTerminalDocumentScope()
    expect(getCellHeight(scope)).toBe(15)
    expect(getCellWidth(scope)).toBe(0)
    expect(viewportToMouseReportCell(scope, 10, 20)).toBeNull()
  })

  it('maps the same zoomed and panned cell through viewport and mouse coordinates', () => {
    const { scope } = measuredScope()
    expect([getCellWidth(scope), getCellHeight(scope), getTotalScale(scope)]).toEqual([8, 17, 1.5])
    expect(cellToViewportPx(scope, 2, 6)).toEqual({ x: 34, y: 45.5 })
    expect(viewportToCell(scope, 34, 45.5)).toEqual({ col: 2, row: 6 })
    expect(viewportToMouseReportCell(scope, 34, 45.5)).toEqual({ col: 2, row: 1, x: 16, y: 17 })
  })

  it('highlights reversed selections using buffer-absolute rows', () => {
    const { scope, select } = measuredScope()
    scope.sel = {
      anchor: { col: 6, row: 10 },
      focus: { col: 2, row: 8 },
      activeHandle: null
    }
    expect(selRange(scope)).toEqual({
      start: { col: 2, row: 8 },
      end: { col: 6, row: 10 }
    })
    applyXtermSelection(scope)
    expect(select).toHaveBeenCalledExactlyOnceWith(2, 8, 165)
  })
})
