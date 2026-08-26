import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  StyleSheet: {
    hairlineWidth: 1,
    create: <T>(styles: T) => styles
  }
}))

import { darkTheme, lightTheme } from '../theme/mobile-theme'
import { createMobileTaskScreenChromeStyles } from './mobile-task-screen-chrome-styles'
import {
  createMobileTaskScreenPalette,
  createMobileTaskScreenStyles
} from './mobile-task-screen-styles'

describe('mobile task screen presentation', () => {
  it.each([lightTheme, darkTheme])('uses the $scheme semantic theme', (theme) => {
    const palette = createMobileTaskScreenPalette(theme)
    const styles = createMobileTaskScreenStyles(theme)
    const chromeStyles = createMobileTaskScreenChromeStyles(theme)

    expect(palette.canvas).toBe(theme.color.bg.canvas)
    expect(palette.surface).toBe(theme.color.bg.surface)
    expect(palette.brand).toBe(theme.color.brand.primary)
    expect(styles.container.backgroundColor).toBe(theme.color.bg.canvas)
    expect(styles.taskRow.backgroundColor).toBe(theme.color.bg.surface)
    expect(styles.searchFieldFocused.borderColor).toBe(theme.color.brand.primary)
    expect(chromeStyles.segmentButton.backgroundColor).toBe(theme.color.bg.surface)
    expect(chromeStyles.segmentButton.minHeight).toBe(theme.size.minimumTouchTarget)
  })

  it('keeps controls reachable and task rows grouped', () => {
    const styles = createMobileTaskScreenStyles(lightTheme)

    expect(styles.providerTab.minHeight).toBeGreaterThanOrEqual(lightTheme.size.minimumTouchTarget)
    expect(styles.filterButton.minHeight).toBeGreaterThanOrEqual(lightTheme.size.minimumTouchTarget)
    expect(styles.clearButton.width).toBe(lightTheme.size.minimumTouchTarget)
    expect(styles.list.borderRadius).toBe(lightTheme.radii.card)
    expect(styles.taskRow.flexDirection).toBe('row')
    expect(styles.taskRow.alignItems).toBe('flex-start')
    expect(styles.taskRow.borderRadius).toBeUndefined()
    expect(styles.separator.backgroundColor).toBe(lightTheme.color.border.subtle)
  })

  it('preserves the structural geometry of task boards and pagination', () => {
    const styles = createMobileTaskScreenStyles(lightTheme)

    expect(styles.boardContainer.gap).toBe(lightTheme.spacing.space12)
    expect(styles.boardColumn.width).toBe(280)
    expect(styles.boardColumn.overflow).toBe('hidden')
    expect(styles.boardCard.borderWidth).toBe(1)
    expect(styles.boardCard.padding).toBe(lightTheme.spacing.space12)
    expect(styles.paginationFooter.flexDirection).toBe('row')
    expect(styles.paginationButton.width).toBe(lightTheme.size.minimumTouchTarget)
    expect(styles.paginationButton.minHeight).toBeGreaterThanOrEqual(
      lightTheme.size.minimumTouchTarget
    )
  })
})
