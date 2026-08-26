import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme } from '../theme/mobile-theme-provider'

export function useFutureFeatureTheme(): MobileTheme {
  return useMobileTheme()
}
