import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  Platform: { select: (choices: Record<string, unknown>) => choices.default },
  StyleSheet: {
    hairlineWidth: 1,
    create: <T>(styles: T) => styles
  }
}))

import { darkTheme, lightTheme } from '../theme/mobile-theme'
import { createMobileNativeChatMessageStyles } from './mobile-native-chat-message-styles'
import { createMobileNativeChatViewStyles } from './mobile-native-chat-view-styles'
import { createMobileSessionReaderStyles } from './mobile-session-reader-styles'
import { createMobileSessionStyles, resolveMobileSessionTheme } from './mobile-session-styles'

describe('Session Graphite presentation', () => {
  it.each([lightTheme, darkTheme])('uses the $scheme semantic theme', (theme) => {
    const message = createMobileNativeChatMessageStyles(theme)
    const view = createMobileNativeChatViewStyles(theme)
    const reader = createMobileSessionReaderStyles(theme)

    expect(message.userBubble.backgroundColor).toBe(theme.color.bg.selected)
    expect(message.userText.color).toBe(theme.color.text.inverse)
    expect(message.toolPreviewLink.color).toBe(theme.color.brand.primary)
    expect(view.root.backgroundColor).toBe(theme.color.bg.canvas)
    expect(view.fab.backgroundColor).toBe(theme.color.bg.elevated)
    expect(reader.markdownTextInput.backgroundColor).toBe(theme.color.bg.canvas)
    expect(reader.filePreviewScroll.backgroundColor).toBe(theme.color.bg.surface)
  })

  it('keeps interactive chat controls at the shared minimum touch target', () => {
    const view = createMobileNativeChatViewStyles(lightTheme)

    expect(view.fab.width).toBe(lightTheme.size.minimumTouchTarget)
    expect(view.fab.height).toBe(lightTheme.size.minimumTouchTarget)
    expect(view.loadEarlier.minHeight).toBe(lightTheme.size.minimumTouchTarget)
  })

  it.each([lightTheme, darkTheme])(
    'themes the $scheme Session shell and terminal controls',
    (theme) => {
      const styles = createMobileSessionStyles(theme)

      expect(styles.container.backgroundColor).toBe(theme.color.bg.canvas)
      expect(styles.sessionChrome.backgroundColor).toBe(theme.color.bg.surface)
      expect(styles.sessionTopBar.minHeight).toBe(theme.size.navigationBarHeight)
      expect(styles.backButton.width).toBe(theme.size.minimumTouchTarget)
      expect(styles.tab.minHeight).toBe(theme.size.minimumTouchTarget)
      expect(styles.createButton.backgroundColor).toBe(theme.color.bg.selected)
      expect(styles.createButtonText.color).toBe(theme.color.text.inverse)
      expect(styles.accessoryBar.backgroundColor).toBe(theme.color.bg.surface)
      expect(styles.accessoryKey.minHeight).toBe(theme.size.minimumTouchTarget)
      expect(styles.sendButton.backgroundColor).toBe(theme.color.bg.selected)
    }
  )

  it('keeps terminal sessions on the selected app theme', () => {
    expect(resolveMobileSessionTheme(lightTheme, 'terminal')).toBe(lightTheme)
    expect(resolveMobileSessionTheme(lightTheme, 'file')).toBe(lightTheme)
    expect(resolveMobileSessionTheme(darkTheme, 'terminal')).toBe(darkTheme)
    expect(resolveMobileSessionTheme(darkTheme, 'browser')).toBe(darkTheme)
  })

  it('binds the large Session route to the runtime semantic theme', () => {
    const source = readFileSync(
      new URL('../../app/h/[hostId]/session/[worktreeId].tsx', import.meta.url),
      'utf8'
    )

    expect(source).toContain('useMobileThemeStyles(createMobileSessionStyles)')
    expect(source).toContain('resolveMobileSessionTheme(theme, activeSessionTab?.type)')
    expect(source).not.toContain("from '../../../../src/theme/mobile-theme'")
    expect(source).not.toMatch(/\bcolors\./)
  })

  it('keeps fixed Session and Quick Command chrome localized', () => {
    const sources = [
      'MobileMarkdownReader.tsx',
      'MobileNativeChatAsk.tsx',
      'MobileNativeChatComposer.tsx',
      'MobileNativeChatQuestion.tsx',
      'MobileNativeChatSessionOptionPickers.tsx',
      'MobileNativeChatView.tsx',
      'QuickCommandEditorForm.tsx',
      'QuickCommandsList.tsx',
      'QuickCommandsSheet.tsx'
    ].map((file) => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8'))
    const source = sources.join('\n')

    for (const label of [
      '重试',
      '取消',
      '提交',
      '发送消息',
      '选择模型',
      '快捷命令',
      '新建快捷命令'
    ]) {
      expect(source).toContain(label)
    }
    for (const legacy of [
      '>Retry<',
      '>Cancel<',
      '>Submit<',
      'accessibilityLabel="Send message"',
      "'Select model'",
      "'Quick Commands'",
      "'New quick command'"
    ]) {
      expect(source).not.toContain(legacy)
    }
  })
})
