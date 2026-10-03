import type { RuntimeMobileTerminalTheme } from '../../../../src/shared/runtime-types'
import { darkTheme } from '../../theme/mobile-theme'

export const DEFAULT_TERMINAL_THEME: RuntimeMobileTerminalTheme['theme'] = darkTheme.terminal

export const MOBILE_TERMINAL_CARET_OPTIONS = {
  cursorBlink: false,
  cursorStyle: 'bar',
  showCursorImmediately: true,
  cursorInactiveStyle: 'block'
} as const
