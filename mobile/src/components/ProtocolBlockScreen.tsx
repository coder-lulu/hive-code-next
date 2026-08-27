import { APP_DISPLAY_NAME, PRODUCT_PUBLIC_LINKS } from '@/product-brand'
import { ShieldAlert } from 'lucide-react-native'
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import type { CompatVerdict } from '../transport/protocol-compat'

type Props = {
  verdict: Extract<CompatVerdict, { kind: 'blocked' }>
}

export function ProtocolBlockScreen({ verdict }: Props) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const isMobileTooOld = verdict.reason === 'mobile-too-old'
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
  const primaryAction = isMobileTooOld
    ? { label: mobileUpdateTarget.label, url: mobileUpdateTarget.url }
    : { label: 'Open desktop download', url: PRODUCT_PUBLIC_LINKS.desktopDownload }

  const title = isMobileTooOld
    ? `Update ${APP_DISPLAY_NAME} Mobile`
    : `Update ${APP_DISPLAY_NAME} on your computer`
  const body = isMobileTooOld
    ? `This desktop needs a newer ${APP_DISPLAY_NAME} Mobile app. Update ${APP_DISPLAY_NAME} Mobile from ${mobileUpdateTarget.storeName}, then try this host again.`
    : `This paired desktop app is too old for your current ${APP_DISPLAY_NAME} Mobile app. Update ${APP_DISPLAY_NAME} on your computer, then try this host again.`
  const recoveryNote =
    'Already updated? Go back to Hosts and refresh the connection. If this message stays, remove this host and pair it again.'

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
          {primaryAction.url ? (
            <Pressable
              accessibilityLabel={primaryAction.label}
              accessibilityRole="link"
              style={({ pressed }) => [
                styles.button,
                styles.primaryButton,
                pressed && styles.pressed
              ]}
              onPress={() => {
                void Linking.openURL(primaryAction.url!)
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
              // Why: route back to the host list so the user can pair a
              // different host instead of getting trapped on this screen.
              router.replace('/')
            }}
          >
            <Text maxFontSizeMultiplier={1.3} style={styles.secondaryButtonText}>
              Back to hosts
            </Text>
          </Pressable>
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
