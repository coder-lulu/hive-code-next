import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  StyleSheet: {
    create: <T>(styles: T) => styles
  }
}))

import { darkTheme, lightTheme } from '../theme/mobile-theme'
import { createTerminalSettingsScreenStyles } from '../terminal/terminal-settings-screen-styles'

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

describe('Terminal and Native Chat Graphite presentation', () => {
  it.each([lightTheme, darkTheme])('uses the $scheme semantic theme', (theme) => {
    const styles = createTerminalSettingsScreenStyles(theme)

    expect(styles.screen.backgroundColor).toBe(theme.color.bg.canvas)
    expect(styles.scrollContent.paddingHorizontal).toBe(theme.spacing.space20)
    expect(styles.settingsGroup.gap).toBe(theme.spacing.space8)
    expect(styles.groupHeading.color).toBe(theme.color.text.secondary)
    expect(styles.emptyState.minHeight).toBe(theme.size.groupedListRowMinHeight)
  })

  it('uses shared settings primitives without legacy palette or hard-coded colors', () => {
    for (const route of [sources.chat, sources.terminal]) {
      expect(route).toContain('useMobileTheme')
      expect(route).toContain('MobileScreenHeader')
      expect(route).toContain('MobileIconButton')
      expect(route).toContain('MobileGroupedList')
    }
    expect(sources.shortcuts).toContain('useMobileTheme')
    expect(sources.shortcuts).toContain('MobileGroupedList')
    expect(sources.shortcuts).toContain('MobileIconButton')

    for (const source of Object.values(sources)) {
      expect(source).not.toMatch(
        /import\s*\{[^}]*\b(?:colors|spacing|typography|radii)\b[^}]*\}\s*from\s*['"][^'"]*mobile-theme['"]/i
      )
      expect(source).not.toMatch(/\bcolors\.|#[0-9a-f]{3,8}|rgba?\(/i)
    }
  })

  it('renders fixed settings chrome in Simplified Chinese', () => {
    expect(sources.chat).toContain('title="聊天界面"')
    expect(sources.chat).toContain('默认以聊天界面打开')
    expect(sources.chat).not.toContain('Open sessions in Chat UI')

    for (const label of [
      '离开应用时',
      '文字大小',
      '键盘输入',
      '自动补全与自动更正',
      '终端文字大小'
    ]) {
      expect(sources.terminal).toContain(label)
    }
    expect(sources.terminal).not.toContain('WHEN YOU LEAVE THE APP')
    expect(sources.terminal).not.toContain('Autocomplete &amp; autocorrect')
    expect(sources.terminal).not.toContain('Terminal text size')

    for (const label of [
      '快捷键栏',
      '恢复默认设置',
      '自定义快捷键',
      '尚未添加自定义快捷键',
      '添加自定义快捷键…'
    ]) {
      expect(sources.shortcuts).toContain(label)
    }
    expect(sources.shortcuts).not.toContain('SHORTCUT BAR')
    expect(sources.shortcuts).not.toContain('Reset Defaults')
    expect(sources.shortcuts).not.toContain('Add Custom Shortcut…')
  })
})
