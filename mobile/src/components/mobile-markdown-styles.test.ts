import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  StyleSheet: {
    hairlineWidth: 1,
    create: <T>(styles: T) => styles
  }
}))

import { darkTheme, lightTheme } from '../theme/mobile-theme'
import { createMobileMarkdownStyles } from './mobile-markdown-styles'

describe('MobileMarkdown presentation', () => {
  it.each([lightTheme, darkTheme])('uses readable $scheme semantic colors', (theme) => {
    const styles = createMobileMarkdownStyles(theme)

    expect(styles.paragraph.color).toBe(theme.color.text.primary)
    expect(styles.heading.color).toBe(theme.color.text.primary)
    expect(styles.quoteText.color).toBe(theme.color.text.secondary)
    expect(styles.link.color).toBe(theme.color.brand.primary)
    expect(styles.codeBlock.backgroundColor).toBe(theme.color.bg.subtle)
    expect(styles.codeText.color).toBe(theme.color.text.primary)
  })

  it('uses the documented typography, radii, and spacing tokens', () => {
    const styles = createMobileMarkdownStyles(lightTheme)

    expect(styles.paragraph.fontSize).toBe(lightTheme.typography.meta.fontSize)
    expect(styles.paragraph.lineHeight).toBe(lightTheme.typography.meta.lineHeight)
    expect(styles.inlineCode.borderRadius).toBe(lightTheme.radii.small)
    expect(styles.codeBlock.borderRadius).toBe(lightTheme.radii.control)
    expect(styles.root.gap).toBe(lightTheme.spacing.space8)
  })
})
