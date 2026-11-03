import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  Platform: { select: (choices: Record<string, unknown>) => choices.default },
  StyleSheet: { hairlineWidth: 1, create: <T>(styles: T) => styles }
}))

import { fileExplorerStyles as explorer } from './mobile-file-explorer-styles'
import { filePreviewStyles as preview } from './mobile-file-preview-styles'
import { applyMobileColorScheme, paletteForScheme } from '../theme/mobile-theme'

afterEach(() => applyMobileColorScheme('dark'))

describe('mobile file presentation', () => {
  it.each(['light', 'dark', 'light'] as const)(
    'uses the %s palette, including the source reader',
    (scheme) => {
      applyMobileColorScheme(scheme)
      const palette = paletteForScheme(scheme)
      expect(explorer.container.backgroundColor).toBe(palette.bgBase)
      expect(explorer.rowTitle.color).toBe(palette.textPrimary)
      expect(preview.container.backgroundColor).toBe(palette.bgBase)
      expect(preview.scroll.backgroundColor).toBe(palette.editorSurface)
      expect(preview.modeContainer.backgroundColor).toBe(palette.editorSurface)
      expect(preview.textPreview.color).toBe(palette.textPrimary)
      expect(preview.editInput.color).toBe(palette.textPrimary)
      expect(preview.modeToggleActive.backgroundColor).toBe(palette.bgRaised)
    }
  )

  it('keeps file rows accessible and preserves compact toolbar geometry', () => {
    expect(explorer.row.minHeight).toBeGreaterThanOrEqual(44)
    expect(explorer.backButton).toMatchObject({ width: 36, height: 36 })
    expect(explorer.inlineRetryButton.minHeight).toBe(28)
    expect(preview.backButton).toMatchObject({ width: 36, height: 36 })
    expect(preview.modeToggle).toMatchObject({ width: 34, height: 28 })
    expect(preview.saveButton).toMatchObject({ width: 36, height: 36 })
  })
})
