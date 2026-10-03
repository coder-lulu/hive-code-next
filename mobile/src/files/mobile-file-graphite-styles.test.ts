import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  StyleSheet: {
    hairlineWidth: 1,
    create: <T>(styles: T) => styles
  }
}))

import { darkTheme, lightTheme } from '../theme/mobile-theme'
import { createFileExplorerStyles } from './mobile-file-explorer-styles'
import { createFilePreviewStyles } from './mobile-file-preview-styles'

describe('mobile file presentation', () => {
  it.each([lightTheme, darkTheme])('uses the $scheme semantic theme', (theme) => {
    const explorer = createFileExplorerStyles(theme)
    const preview = createFilePreviewStyles(theme)

    expect(explorer.container.backgroundColor).toBe(theme.color.bg.canvas)
    expect(explorer.row.backgroundColor).toBe(theme.color.bg.surface)
    expect(explorer.rowTitle.color).toBe(theme.color.text.primary)
    expect(preview.container.backgroundColor).toBe(theme.color.bg.canvas)
    expect(preview.scroll.backgroundColor).toBe(theme.color.bg.surface)
    expect(preview.sourceScroll.backgroundColor).toBe(darkTheme.color.bg.surface)
    expect(preview.textPreview.color).toBe(darkTheme.color.text.primary)
    expect(preview.modeToggleActive.backgroundColor).toBe(theme.color.bg.selected)
  })

  it('keeps explorer and preview controls at the shared minimum touch target', () => {
    const explorer = createFileExplorerStyles(lightTheme)
    const preview = createFilePreviewStyles(lightTheme)

    expect(explorer.backButton.width).toBe(lightTheme.size.minimumTouchTarget)
    expect(explorer.inlineRetryButton.minHeight).toBe(lightTheme.size.minimumTouchTarget)
    expect(explorer.row.minHeight).toBe(lightTheme.size.groupedListRowMinHeight)
    expect(preview.backButton.width).toBe(lightTheme.size.minimumTouchTarget)
    expect(preview.modeToggle.width).toBe(lightTheme.size.minimumTouchTarget)
    expect(preview.retryButton.minHeight).toBe(lightTheme.size.minimumTouchTarget)
  })
})
