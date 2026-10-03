import { useWallAppUpdate } from '../app-update/use-wall-app-update'
import { APP_DISPLAY_NAME, PRODUCT_PUBLIC_LINKS } from '@/product-brand'
import { ShieldAlert } from 'lucide-react-native'
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { openExternalLink } from '../platform/external-link'
import { useRouteHandoff } from '../navigation/route-handoff'
import type { CompatVerdict } from '../transport/protocol-compat'
import type { MobileWebBundleCompatVerdict } from '../transport/mobile-web-bundle-compat'

/** Every wall this screen renders: the protocol one and the bundle one. Both are terminal — there
 *  is no native workspace to fall back to, so the only way out is updating one of the two apps. */
export type BlockedVerdict =
  | Extract<CompatVerdict, { kind: 'blocked' }>
  | Extract<MobileWebBundleCompatVerdict, { kind: 'blocked' }>
type Props = {
  verdict: BlockedVerdict
}

const DESKTOP_TOO_OLD_BODY = `This paired desktop app is too old for your current ${APP_DISPLAY_NAME} Mobile app. Update ${APP_DISPLAY_NAME} on your computer, then try this host again.`

/** What clears the wall. `refresh-bundle` is the one that no store can: the cached workspace is
 *  older than this host's client floor, so a download fixes it and an app update does not. */
type BlockRemedy = 'update-mobile' | 'update-desktop' | 'refresh-bundle'
type BlockAction =
  | { kind: 'install'; label: string; onPress: () => void; disabled: boolean }
  | { kind: 'link'; label: string; url: string }

function blockRemedy(verdict: BlockedVerdict): BlockRemedy {
  switch (verdict.reason) {
    case 'mobile-too-old':
    case 'bundle-shell-too-old':
      return 'update-mobile'
    case 'desktop-too-old':
    case 'bundle-unavailable':
      return 'update-desktop'
    case 'bundle-incompatible':
      return verdict.side === 'desktop' ? 'update-desktop' : 'refresh-bundle'
  }
}

function blockTitle(remedy: BlockRemedy): string {
  switch (remedy) {
    case 'update-mobile':
      return `Update ${APP_DISPLAY_NAME} Mobile`
    case 'update-desktop':
      return `Update ${APP_DISPLAY_NAME} on your computer`
    case 'refresh-bundle':
      return 'Refresh the mobile workspace'
  }
}

function blockBody(verdict: BlockedVerdict, remedy: BlockRemedy, storeName: string): string {
  if (remedy === 'refresh-bundle') {
    return 'The workspace cached for this host is older than the desktop expects. Reconnect to this host to download the current one.'
  }
  if (verdict.reason === 'mobile-too-old') {
    return `This desktop needs a newer ${APP_DISPLAY_NAME} Mobile app. Update ${APP_DISPLAY_NAME} Mobile from ${storeName}, then try this host again.`
  }
  if (verdict.reason === 'bundle-unavailable') {
    return `This paired desktop app does not include the mobile workspace yet. Update ${APP_DISPLAY_NAME} on your computer, then try this host again.`
  }
  if (remedy === 'update-mobile') {
    return `This desktop's mobile workspace needs a newer ${APP_DISPLAY_NAME} Mobile app. Update ${APP_DISPLAY_NAME} Mobile from ${storeName}, then try this host again.`
  }
  return DESKTOP_TOO_OLD_BODY
}

export function ProtocolBlockScreen({ verdict }: Props) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const router = useRouteHandoff()
  const mobileUpdate = useWallAppUpdate()
  const remedy = blockRemedy(verdict)
  const mobileUpdateTarget =
    Platform.OS === 'ios'
      ? {
          label: 'Open iOS download',
          url: PRODUCT_PUBLIC_LINKS.iosDownload,
          storeName: 'the official iOS distribution channel'
        }
      : {
          label: 'Open Android download',
          url: PRODUCT_PUBLIC_LINKS.androidDownload,
          storeName: 'the official Android distribution channel'
        }
  // No download to offer when the fix is a refetch: reconnecting is what this screen leaves you to do.
  const primaryAction: BlockAction | null =
    remedy === 'refresh-bundle'
      ? null
      : remedy === 'update-mobile'
        ? mobileUpdate
          ? {
              kind: 'install',
              label: `获取 ${APP_DISPLAY_NAME} ${mobileUpdate.version}`,
              onPress: () => {
                void mobileUpdate.install()
              },
              disabled: mobileUpdate.pending
            }
          : mobileUpdateTarget.url
            ? { kind: 'link', label: mobileUpdateTarget.label, url: mobileUpdateTarget.url }
            : null
        : PRODUCT_PUBLIC_LINKS.desktopDownload
          ? {
              kind: 'link',
              label: 'Open desktop download',
              url: PRODUCT_PUBLIC_LINKS.desktopDownload
            }
          : null

  const title = blockTitle(remedy)
  const body = blockBody(verdict, remedy, mobileUpdateTarget.storeName)
  const recoveryNote =
    remedy === 'refresh-bundle'
      ? 'If this message stays, remove this host and pair it again.'
      : 'Already updated? Go back to Hosts and refresh the connection. If this message stays, remove this host and pair it again.'

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <ScrollView
        bounces={false}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.icon}
          >
            <ShieldAlert color={theme.color.status.warning} size={24} strokeWidth={2} />
          </View>
          <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={styles.title}>
            {title}
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.body}>
            {body}
          </Text>
          {primaryAction ? (
            <Pressable
              accessibilityLabel={primaryAction.label}
              accessibilityRole={primaryAction.kind === 'install' ? 'button' : 'link'}
              disabled={primaryAction.kind === 'install' && primaryAction.disabled}
              accessibilityState={{
                busy: primaryAction.kind === 'install' && primaryAction.disabled
              }}
              style={({ pressed }) => [
                styles.button,
                styles.primaryButton,
                pressed && styles.pressed
              ]}
              onPress={() => {
                if (primaryAction.kind === 'install') {
                  primaryAction.onPress()
                } else {
                  openExternalLink(primaryAction.url)
                }
              }}
            >
              <Text maxFontSizeMultiplier={1.3} style={styles.primaryButtonText}>
                {primaryAction.label}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityLabel="Back to hosts"
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.button,
              styles.secondaryButton,
              pressed && styles.pressed
            ]}
            onPress={() => {
              // The hybrid shell hands this native route back to the app.
              router.replace('/')
            }}
          >
            <Text maxFontSizeMultiplier={1.3} style={styles.secondaryButtonText}>
              Back to hosts
            </Text>
          </Pressable>
          {mobileUpdate?.message ? (
            <Text
              accessibilityLiveRegion="polite"
              maxFontSizeMultiplier={1.3}
              style={styles.recoveryNote}
            >
              {mobileUpdate.message}
            </Text>
          ) : null}
          <Text maxFontSizeMultiplier={1.3} style={styles.recoveryNote}>
            {recoveryNote}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: theme.color.bg.canvas },
    container: {
      flexGrow: 1,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space20,
      paddingVertical: theme.spacing.space24,
      backgroundColor: theme.color.bg.canvas
    },
    card: {
      width: '100%',
      alignSelf: 'center',
      padding: theme.spacing.space20,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface
    },
    icon: {
      width: theme.spacing.space48,
      height: theme.spacing.space48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.subtle,
      marginBottom: theme.spacing.space16
    },
    title: {
      ...theme.typography.pageTitle,
      color: theme.color.text.primary,
      marginBottom: theme.spacing.space8
    },
    body: {
      ...theme.typography.body,
      color: theme.color.text.secondary,
      marginBottom: theme.spacing.space20
    },
    button: {
      minHeight: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space12,
      borderRadius: theme.radii.control
    },
    primaryButton: {
      backgroundColor: theme.color.bg.selected,
      marginBottom: theme.spacing.space8
    },
    primaryButtonText: {
      ...theme.typography.label,
      color: theme.color.text.inverse,
      fontWeight: '600'
    },
    secondaryButton: {
      borderWidth: 1,
      borderColor: theme.color.border.default,
      backgroundColor: theme.color.bg.surface
    },
    secondaryButtonText: {
      ...theme.typography.label,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    recoveryNote: {
      ...theme.typography.caption,
      color: theme.color.text.tertiary,
      marginTop: theme.spacing.space12
    },
    pressed: { opacity: 0.72 }
  })
}
