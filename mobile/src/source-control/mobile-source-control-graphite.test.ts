import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  StyleSheet: {
    hairlineWidth: 1,
    create: <T>(styles: T) => styles
  }
}))

import { darkTheme, lightTheme } from '../theme/mobile-theme'
import { createMobileSourceControlHubStyles } from './mobile-source-control-hub-styles'
import { createMobileSourceControlStyles } from './mobile-source-control-styles'

const contentSource = readFileSync(
  new URL('./MobileSourceControlContent.tsx', import.meta.url),
  'utf8'
)
const prChipSource = readFileSync(
  new URL('./MobileSourceControlPrChip.tsx', import.meta.url),
  'utf8'
)

describe('mobile source control Graphite presentation', () => {
  it.each([lightTheme, darkTheme])('uses the $scheme semantic theme', (theme) => {
    const styles = createMobileSourceControlStyles(theme)
    const hubStyles = createMobileSourceControlHubStyles(theme)

    expect(styles.container.backgroundColor).toBe(theme.color.bg.canvas)
    expect(styles.header.backgroundColor).toBe(theme.color.bg.surface)
    expect(styles.summaryCard).toMatchObject({
      backgroundColor: theme.color.bg.surface,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.card
    })
    expect(styles.commitBar.backgroundColor).toBe(theme.color.bg.surface)
    expect(styles.commitButton.backgroundColor).toBe(theme.color.bg.selected)
    expect(styles.commitButtonText.color).toBe(theme.color.text.inverse)
    expect(hubStyles.segments.backgroundColor).toBe(theme.color.bg.surface)
    expect(hubStyles.segmentActive.borderBottomColor).toBe(theme.color.text.primary)
    expect(hubStyles.chipCreateText.color).toBe(theme.color.brand.primary)
  })

  it('keeps source-control controls at the shared minimum touch target', () => {
    const styles = createMobileSourceControlStyles(lightTheme)
    const hubStyles = createMobileSourceControlHubStyles(lightTheme)

    expect(styles.backButton.width).toBe(lightTheme.size.minimumTouchTarget)
    expect(styles.refreshButton.width).toBe(lightTheme.size.minimumTouchTarget)
    expect(styles.fileRow.minHeight).toBe(lightTheme.size.groupedListRowMinHeight)
    expect(styles.iconButton.width).toBe(lightTheme.size.minimumTouchTarget)
    expect(styles.commitButton.minHeight).toBe(lightTheme.size.minimumTouchTarget)
    expect(styles.generateButton.width).toBe(lightTheme.size.minimumTouchTarget)
    expect(hubStyles.segment.minHeight).toBe(lightTheme.size.minimumTouchTarget)
  })

  it('renders the reported fixed source-control chrome in Chinese', () => {
    expect(contentSource).toContain('>全部暂存</Text>')
    expect(contentSource).toContain('>全部取消暂存</Text>')
    expect(contentSource).toContain('placeholder="提交说明"')
    expect(contentSource).not.toContain('>Stage All</Text>')
    expect(contentSource).not.toContain('>Unstage All</Text>')
    expect(contentSource).not.toContain('placeholder="Commit message"')
    expect(prChipSource).toContain('创建拉取请求')
    expect(prChipSource).not.toContain('>Create pull request</Text>')
    expect(prChipSource).not.toContain('Loading pull request…')
  })
})
