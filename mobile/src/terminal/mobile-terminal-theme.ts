import type { MobileTheme } from '../theme/mobile-theme'
import { darkTheme, lightTheme } from '../theme/mobile-theme'
import type { MobileTerminalTheme } from './terminal-webview-contract'

const graphiteTerminalThemes = {
  light: { mode: 'light', theme: lightTheme.terminal },
  dark: { mode: 'dark', theme: darkTheme.terminal }
} as const satisfies Record<MobileTheme['scheme'], MobileTerminalTheme>

export function resolveMobileTerminalTheme(
  theme: MobileTheme,
  runtimeTheme?: MobileTerminalTheme
): MobileTerminalTheme {
  return runtimeTheme?.mode === theme.scheme ? runtimeTheme : graphiteTerminalThemes[theme.scheme]
}
