import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  Platform: { select: (choices: Record<string, unknown>) => choices.default },
  StyleSheet: { hairlineWidth: 1, create: <T>(styles: T) => styles }
}))

import { styles } from './mobile-markdown-styles'
import { applyMobileColorScheme, paletteForScheme, radii, spacing } from '../theme/mobile-theme'

afterEach(() => applyMobileColorScheme('dark'))

describe('MobileMarkdown presentation', () => {
  it.each(['light', 'dark', 'light'] as const)(
    'uses readable %s colors on the live stylesheet',
    (scheme) => {
      applyMobileColorScheme(scheme)
      const palette = paletteForScheme(scheme)
      expect(styles.paragraph.color).toBe(palette.textPrimary)
      expect(styles.heading.color).toBe(palette.textPrimary)
      expect(styles.quoteText.color).toBe(palette.textSecondary)
      expect(styles.link.color).toBe(palette.accentBlue)
      expect(styles.codeBlock.backgroundColor).toBe(palette.bgRaised)
      expect(styles.codeText.color).toBe(palette.textPrimary)
    }
  )

  it('keeps prose readable and uses shared radii and spacing', () => {
    expect(styles.paragraph).toMatchObject({ fontSize: 13, lineHeight: 19 })
    expect(styles.paragraph.lineHeight).toBeGreaterThan(styles.paragraph.fontSize)
    expect(styles.inlineCode.borderRadius).toBe(radii.row)
    expect(styles.codeBlock.borderRadius).toBe(radii.input)
    expect(styles.root.gap).toBe(spacing.md)
  })
})
