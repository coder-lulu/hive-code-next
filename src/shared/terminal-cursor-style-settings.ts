import type { GlobalSettings } from './global-settings-types'

type TerminalCursorStyleSettings = Pick<GlobalSettings, 'terminalCursorStyle'>

function isTerminalCursorStyle(value: unknown): value is GlobalSettings['terminalCursorStyle'] {
  return value === 'bar' || value === 'block' || value === 'underline'
}

export function normalizeTerminalCursorStyleDefault(
  settings: Partial<TerminalCursorStyleSettings> | undefined
): TerminalCursorStyleSettings {
  return {
    terminalCursorStyle: isTerminalCursorStyle(settings?.terminalCursorStyle)
      ? settings.terminalCursorStyle
      : 'block'
  }
}
