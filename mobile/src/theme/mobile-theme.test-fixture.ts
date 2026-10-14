import { lightTheme } from './mobile-theme'

// Explicit component-test theme; provider hydration and scheme behavior have their own suite.
export function createLightThemeTestModule() {
  return {
    useMobileTheme: () => lightTheme,
    useMobileThemeStyles: <T>(createStyles: (theme: typeof lightTheme) => T): T =>
      createStyles(lightTheme)
  }
}
