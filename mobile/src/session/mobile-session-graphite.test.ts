import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  Platform: { select: (choices: Record<string, unknown>) => choices.default },
  StyleSheet: { hairlineWidth: 1, create: <T>(styles: T) => styles }
}))

import { activateMobileUiLocale, translate } from '../i18n/mobile-i18n'
import { styles as message } from './native-chat/transcript/mobile-native-chat-message-styles'
import { styles as view } from './mobile-native-chat-view-styles'
import { mobileSessionReaderStyles as reader } from './mobile-session-reader-styles'
import { styles } from './mobile-session-styles'
import {
  composerInputStyles as composer,
  COMPOSER_CONTROL_SIZE
} from '../components/composer-input/composer-input-styles'
import {
  readMobileSessionRouteSource,
  readMobileSessionRouteSourceFamily
} from './mobile-session-route-source-family.test-support'
import { applyMobileColorScheme, paletteForScheme } from '../theme/mobile-theme'

afterEach(() => applyMobileColorScheme('dark'))

afterEach(() => activateMobileUiLocale('en'))

describe('Session live presentation', () => {
  it.each(['light', 'dark', 'light'] as const)(
    'uses the %s palette in the actual transcript and readers',
    (scheme) => {
      applyMobileColorScheme(scheme)
      const palette = paletteForScheme(scheme)
      expect(message.userBubble.backgroundColor).toBe(palette.chatUserSurface)
      expect(message.userBubble.borderColor).toBe(palette.chatUserBorder)
      expect(view.root.backgroundColor).toBe(palette.bgBase)
      expect(view.fab.backgroundColor).toBe(palette.bgRaised)
      expect(reader.markdownTextInput.backgroundColor).toBe(palette.bgBase)
      expect(reader.filePreviewScroll.backgroundColor).toBe(palette.editorSurface)
    }
  )

  it('keeps the compact jump control and full-height history action', () => {
    expect(view.fab).toMatchObject({ width: 38, height: 38 })
    expect(view.loadEarlier.height).toBeGreaterThanOrEqual(44)
  })

  it.each(['light', 'dark'] as const)(
    'themes the %s merged Session shell and composer',
    (scheme) => {
      applyMobileColorScheme(scheme)
      const palette = paletteForScheme(scheme)
      expect(styles.container.backgroundColor).toBe(palette.bgBase)
      expect(styles.sessionChrome.backgroundColor).toBe(palette.bgPanel)
      expect(styles.sessionTopBar.minHeight).toBe(44)
      expect(styles.headerButton).toMatchObject({ width: 36, height: 36 })
      expect(styles.tab.minHeight).toBeGreaterThanOrEqual(44)
      expect(styles.createButton.backgroundColor).toBe(palette.bgRaised)
      expect(styles.createButtonText.color).toBe(palette.textPrimary)
      expect(composer.box.backgroundColor).toBe(palette.composerSurface)
      expect(composer.sendButton.backgroundColor).toBe(palette.surfaceBright)
      expect(composer.controlButton).toMatchObject({
        width: COMPOSER_CONTROL_SIZE,
        height: COMPOSER_CONTROL_SIZE
      })
    }
  )

  it('keeps terminal, file and browser panes on the selected app palette', () => {
    for (const scheme of ['light', 'dark', 'light'] as const) {
      applyMobileColorScheme(scheme)
      const palette = paletteForScheme(scheme)
      expect(styles.container.backgroundColor).toBe(palette.bgBase)
      expect(reader.filePreviewScroll.backgroundColor).toBe(palette.editorSurface)
      expect(styles.browserFrame.flex).toBe(1)
    }
  })

  it('binds the split Session surface to live styles and scheme subscription', () => {
    const source = readMobileSessionRouteSourceFamily()
    expect(source).toContain('useMobileColorScheme()')
    expect(readMobileSessionRouteSource('./mobile-session-styles.ts')).toContain('themedStyles(')
    expect(source).toContain('mobile-session-styles')
  })

  it('localizes fixed Session and Quick Command chrome through current producers', async () => {
    await activateMobileUiLocale('zh')
    const cases = [
      ['../components/MobileLoadErrorState.tsx', 'common.retry', '重试'],
      ['native-chat/input/MobileNativeChatAsk.tsx', 'common.cancel', '取消'],
      ['native-chat/input/MobileNativeChatAsk.tsx', 'chat.ask.submit', '提交'],
      [
        'native-chat/composer/MobileNativeChatComposer.tsx',
        'chat.composer.sendMessage',
        '发送消息'
      ],
      ['QuickCommandsSheet.tsx', 'session.quickCommandsSheet.title', '快捷命令'],
      ['QuickCommandsList.tsx', 'session.quickCommandsList.newCommand', '新建快捷命令']
    ]
    const picker = readMobileSessionRouteSource(
      './native-chat/input/MobileNativeChatSessionOptionPickers.tsx'
    )
    expect(picker).toContain('chat.sessionOptionPickers.modelLabel')
    expect(
      translate('chat.sessionOptionPickers.modelLabel', 'missing translation', { value: 'Claude' })
    ).toBe('模型，Claude')
    for (const [file, key, label] of cases) {
      expect(readMobileSessionRouteSource('./' + file)).toContain(key)
      expect(translate(key, 'missing translation')).toBe(label)
    }
  })
})
