import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  Platform: { select: (choices: Record<string, unknown>) => choices.default },
  StyleSheet: { hairlineWidth: 1, create: <T>(styles: T) => styles }
}))

import { styles } from './mobile-source-control-styles'
import { hubStyles } from './mobile-source-control-hub-styles'
import { COMPOSER_CONTROL_SIZE } from '../components/composer-input/composer-input-styles'
import { activateMobileUiLocale, translate } from '../i18n/mobile-i18n'
import { applyMobileColorScheme, paletteForScheme, radii } from '../theme/mobile-theme'

afterEach(() => applyMobileColorScheme('dark'))
afterEach(() => activateMobileUiLocale('en'))
const contentSource = readFileSync(
  new URL('./MobileSourceControlContent.tsx', import.meta.url),
  'utf8'
)
const prChipSource = readFileSync(
  new URL('./MobileSourceControlPrChip.tsx', import.meta.url),
  'utf8'
)

describe('mobile source control presentation', () => {
  it.each(['light', 'dark', 'light'] as const)('uses the %s semantic palette', (scheme) => {
    applyMobileColorScheme(scheme)
    const palette = paletteForScheme(scheme)
    expect(styles.container.backgroundColor).toBe(palette.bgBase)
    expect(styles.header.backgroundColor).toBe(palette.bgPanel)
    expect(styles.summaryCard).toMatchObject({
      backgroundColor: palette.bgPanel,
      borderColor: palette.borderSubtle,
      borderRadius: radii.card
    })
    expect(styles.commitBar.backgroundColor).toBe(palette.bgPanel)
    expect(styles.commitButton.backgroundColor).toBe(palette.surfaceBright)
    expect(styles.commitButtonText.color).toBe(palette.bgBase)
    expect(hubStyles.segments.backgroundColor).toBe(palette.bgPanel)
    expect(hubStyles.segmentActive.borderBottomColor).toBe(palette.textPrimary)
    expect(hubStyles.chipCreateText.color).toBe(palette.accentBlue)
  })

  it('preserves full-height file rows and compact toolbar and composer controls', () => {
    expect(styles.backButton).toMatchObject({ width: 36, height: 36 })
    expect(styles.refreshButton).toMatchObject({ width: 36, height: 36 })
    expect(styles.fileRow.minHeight).toBeGreaterThanOrEqual(44)
    expect(styles.iconButton).toMatchObject({ width: 32, height: 32 })
    expect(styles.commitButton.height).toBe(COMPOSER_CONTROL_SIZE)
    expect(hubStyles.segment.minHeight).toBe(40)
    expect(hubStyles.segment.borderBottomWidth).toBe(2)
  })

  it('translates fixed source-control chrome through the actual Chinese catalog', async () => {
    await activateMobileUiLocale('zh')
    for (const [key, label] of [
      ['sourceControl.content.stageAll', '暂存全部'],
      ['sourceControl.content.unstageAll', '取消全部暂存'],
      ['sourceControl.content.commitMessagePlaceholder', '提交信息']
    ]) {
      expect(contentSource).toContain(key)
      expect(translate(key, 'missing translation')).toBe(label)
    }
    expect(prChipSource).toContain('sourceControl.prChip.createPr')
    expect(translate('sourceControl.prChip.createPr', 'missing translation')).toBe('创建 PR')
    expect(contentSource).not.toContain('>Stage All</Text>')
    expect(contentSource).not.toContain('>Unstage All</Text>')
    expect(contentSource).not.toContain('placeholder="Commit message"')
    expect(prChipSource).not.toContain('>Create pull request</Text>')
  })
})
