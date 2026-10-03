import { AuthFailedBannerActions } from './AuthFailedBannerActions'
import {
  createAuthFailedBannerStyles,
  type AuthFailedBannerCopy
} from './auth-failed-banner-styles'
import { TriangleAlert } from 'lucide-react-native'
import { Text, View } from 'react-native'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'

const DEFAULT_COPY: AuthFailedBannerCopy = {
  message:
    'Authentication failed — try reconnecting first; if it keeps failing, re-pair from desktop.',
  retry: 'Retry',
  retryAccessibility: 'Retry authentication',
  repair: 'Re-pair',
  repairAccessibility: 'Re-pair this computer',
  remove: 'Remove',
  removeAccessibility: 'Remove this computer'
}

// Why: auth-failed is no longer necessarily terminal (issue #5200) — a
// transient rejection can latch it even though the desktop still lists this
// device. Offer Retry (fresh client + handshake) ahead of the disruptive
// re-pair flow so the common transient case recovers without re-pairing.
export function AuthFailedBanner({
  canRetry,
  copy: copyOverrides,
  onRetry,
  onRepair,
  onRemove
}: {
  canRetry: boolean
  copy?: Partial<AuthFailedBannerCopy>
  onRetry: () => void
  onRepair: () => void
  onRemove?: () => void
}) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createAuthFailedBannerStyles)
  const copy = { ...DEFAULT_COPY, ...copyOverrides }

  return (
    <View style={styles.banner}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <TriangleAlert color={theme.color.status.danger} size={20} strokeWidth={2} />
      </View>
      <View style={styles.content}>
        <Text maxFontSizeMultiplier={1.3} style={styles.text}>
          {copy.message}
        </Text>
        <View style={styles.actions}>
          <AuthFailedBannerActions
            canRetry={canRetry}
            copy={copy}
            styles={styles}
            onRetry={onRetry}
            onRepair={onRepair}
            onRemove={onRemove}
          />
        </View>
      </View>
    </View>
  )
}
