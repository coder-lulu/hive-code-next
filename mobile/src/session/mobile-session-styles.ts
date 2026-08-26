import type { MobileTheme } from '../theme/mobile-theme'
import { createMobileSessionCommandInputStyles } from './mobile-session-command-input-styles'
import { createMobileSessionFrameStyles } from './mobile-session-frame-styles'
import { createMobileSessionReaderStyles } from './mobile-session-reader-styles'
import { createMobileSessionReviewCommentStyles } from './mobile-session-review-comment-styles'
import type { MobileSessionTabType } from './mobile-session-route-types'

export function resolveMobileSessionTheme(
  theme: MobileTheme,
  _activeTabType: MobileSessionTabType | undefined
): MobileTheme {
  return theme
}

export function createMobileSessionStyles(theme: MobileTheme) {
  return {
    ...createMobileSessionFrameStyles(theme),
    ...createMobileSessionReaderStyles(theme),
    ...createMobileSessionReviewCommentStyles(theme),
    ...createMobileSessionCommandInputStyles(theme)
  }
}
