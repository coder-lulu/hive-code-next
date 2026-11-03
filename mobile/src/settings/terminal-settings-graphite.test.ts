import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  Platform: { select: (choices: Record<string, unknown>) => choices.default },
  StyleSheet: { hairlineWidth: 1, create: <T>(styles: T) => styles }
}))

import { terminalSettingsScreenStyles as styles } from '../terminal/terminal-settings-screen-styles'
import { activateMobileUiLocale, translate } from '../i18n/mobile-i18n'
import { applyMobileColorScheme, paletteForScheme, radii, spacing } from '../theme/mobile-theme'

afterEach(() => applyMobileColorScheme('dark'))
afterEach(() => activateMobileUiLocale('en'))
const sources = {
  chat: readFileSync(
    fileURLToPath(new URL('./native-chat-settings-screen.tsx', import.meta.url)),
    'utf8'
  ),
  terminal: readFileSync(
    fileURLToPath(new URL('../../app/terminal-settings.tsx', import.meta.url)),
    'utf8'
  ),
  shortcuts: readFileSync(
    fileURLToPath(new URL('../components/TerminalShortcutSettings.tsx', import.meta.url)),
    'utf8'
  )
} as const

describe('Terminal and Native Chat presentation', () => {
  it.each(['light', 'dark', 'light'] as const)(
    'uses the %s palette without freezing settings styles',
    (scheme) => {
      applyMobileColorScheme(scheme)
      const palette = paletteForScheme(scheme)
      expect(styles.container.backgroundColor).toBe(palette.bgBase)
      expect(styles.container.paddingHorizontal).toBe(spacing.lg)
      expect(styles.scrollContent.paddingBottom).toBe(spacing.xl)
      expect(styles.section).toMatchObject({
        backgroundColor: palette.bgPanel,
        borderRadius: radii.card
      })
      expect(styles.groupHeading.color).toBe(palette.textMuted)
      expect(styles.rowLabel.color).toBe(palette.textPrimary)
      expect(styles.row.paddingVertical).toBe(spacing.md)
    }
  )

  it('subscribes all settings surfaces to the live theme with maintained token owners', () => {
    for (const source of Object.values(sources)) {
      expect(source).toContain('useMobileColorScheme()')
      // These two deliberate destructive hover tints are the current exception; neutral chrome
      // must still use live tokens. Do not redesign that surface from this fixture migration.
      const fixedColors = source.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi) ?? []
      expect(fixedColors).toEqual(
        source === sources.shortcuts ? ['rgba(239, 68, 68, 0.1)', 'rgba(239, 68, 68, 0.2)'] : []
      )
    }
    expect(sources.chat).toContain('themedStyleSheet(')
    expect(sources.shortcuts).toContain('themedStyleSheet(')
    expect(sources.terminal).toContain('terminalSettingsScreenStyles as styles')
  })

  it('renders settings chrome through the actual Simplified Chinese catalog', async () => {
    await activateMobileUiLocale('zh')
    const cases = [
      [sources.chat, 'settings.nativeChatSettingsScreen.title', '聊天界面'],
      [sources.chat, 'settings.nativeChatSettingsScreen.openInChatUi', '在聊天界面中打开会话'],
      [sources.terminal, 'app.terminalSettings.leaveAppHeading', '离开应用时'],
      [sources.terminal, 'app.terminalSettings.textSizeHeading', '文字大小'],
      [sources.terminal, 'app.terminalSettings.keyboardInputHeading', '键盘输入'],
      [sources.terminal, 'app.terminalSettings.autocomplete', '自动补全与自动纠正'],
      [sources.terminal, 'app.terminalSettings.textSizePickerTitle', '终端文字大小'],
      [sources.shortcuts, 'components.terminalShortcutSettings.resetDefaults', '恢复默认设置'],
      [sources.shortcuts, 'components.terminalShortcutSettings.customShortcuts', '自定义快捷键'],
      [sources.shortcuts, 'components.terminalShortcutSettings.empty', '尚未设置自定义快捷键。'],
      [sources.shortcuts, 'components.terminalShortcutSettings.addShortcut', '添加自定义快捷键…']
    ]
    for (const [source, key, label] of cases) {
      expect(source).toContain(key)
      expect(translate(key, 'missing translation')).toBe(label)
    }
    expect(sources.chat).not.toContain('title="聊天界面"')
  })
})
