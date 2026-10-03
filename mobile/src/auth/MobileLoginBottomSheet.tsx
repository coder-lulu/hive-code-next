import { Check, Smartphone, X } from 'lucide-react-native'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { OrcaLogo } from '../components/OrcaLogo'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { MobileLoginActionButton } from './MobileLoginActionButton'
import { MobileLoginProviderIcon } from './MobileLoginProviderIcon'
import { createMobileLoginBottomSheetStyles } from './mobile-login-bottom-sheet-styles'
import {
  enabledMobileLoginProviders,
  mobileLoginAttemptAllowed,
  type MobileLoginAction,
  type MobileLoginConfiguration
} from './mobile-login-presentation'

type MobileLoginBottomSheetProps = {
  readonly agreed: boolean
  readonly busyActionKey: string | null
  readonly configuration: MobileLoginConfiguration
  readonly onAction: (action: MobileLoginAction) => void
  readonly onAgreementChange: (agreed: boolean) => void
  readonly onAgreementRequired: () => void
  readonly onClose: () => void
  readonly onOpenPrivacy: () => void
  readonly onOpenTerms: () => void
}

export function MobileLoginBottomSheet({
  agreed,
  busyActionKey,
  configuration,
  onAction,
  onAgreementChange,
  onAgreementRequired,
  onClose,
  onOpenPrivacy,
  onOpenTerms
}: MobileLoginBottomSheetProps) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createMobileLoginBottomSheetStyles)
  const insets = useSafeAreaInsets()
  const { height: viewportHeight } = useWindowDimensions()
  const providers = enabledMobileLoginProviders(configuration)
  const actionPending = busyActionKey !== null
  const requestAction = (action: MobileLoginAction) => {
    if (!mobileLoginAttemptAllowed(agreed)) {
      onAgreementRequired()
      return
    }
    onAction(action)
  }

  return (
    <View style={styles.screen}>
      <Pressable
        accessibilityLabel="关闭登录"
        accessibilityRole="button"
        onPress={onClose}
        style={styles.backdrop}
      />
      <View style={[styles.sheet, { maxHeight: Math.round(viewportHeight * 0.63) }]}>
        <View style={styles.handleArea} pointerEvents="none">
          <View style={styles.handle} />
        </View>
        <Pressable
          accessibilityLabel="关闭登录"
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => [styles.closeButton, pressed && styles.closePressed]}
        >
          <X color={theme.color.text.secondary} size={24} strokeWidth={1.8} />
        </Pressable>
        <ScrollView
          bounces={false}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insets.bottom + theme.spacing.space16 }
          ]}
          showsVerticalScrollIndicator={false}
          style={styles.scroll}
        >
          <View style={styles.brandRow}>
            <OrcaLogo size={44} unframed />
            <View style={styles.brandCopy}>
              <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={styles.title}>
                登录 HiveCode
              </Text>
              <Text maxFontSizeMultiplier={1.3} style={styles.subtitle}>
                同步云端任务、工作区与账号偏好
              </Text>
            </View>
          </View>

          <View style={styles.actions}>
            <MobileLoginActionButton
              busy={busyActionKey === 'phone'}
              disabled={actionPending}
              icon={Smartphone}
              label="手机号登录"
              onPress={() => requestAction({ kind: 'phone' })}
              styles={styles}
              theme={theme}
              variant="primary"
            />
          </View>

          {providers.length > 0 ? (
            <View style={styles.providerSection}>
              <View style={styles.providerHeading}>
                <View style={styles.providerRule} />
                <Text maxFontSizeMultiplier={1.3} style={styles.providerTitle}>
                  其他方式登录
                </Text>
                <View style={styles.providerRule} />
              </View>
              <View style={styles.providerGrid}>
                {providers.map((provider) => {
                  const actionKey = `provider:${provider.id}`
                  const busy = busyActionKey === actionKey
                  const disabled = actionPending
                  return (
                    <Pressable
                      accessibilityLabel={provider.accessibilityLabel}
                      accessibilityRole="button"
                      accessibilityState={{ busy, disabled }}
                      disabled={disabled}
                      key={provider.id}
                      onPress={() => requestAction({ kind: 'provider', providerId: provider.id })}
                      style={({ pressed }) => [
                        styles.providerButton,
                        pressed && styles.providerPressed,
                        disabled && styles.actionDisabled
                      ]}
                    >
                      {busy ? (
                        <ActivityIndicator color={theme.color.text.primary} size="small" />
                      ) : (
                        <MobileLoginProviderIcon
                          backgroundColor={theme.color.bg.surface}
                          color={theme.color.text.primary}
                          providerId={provider.id}
                        />
                      )}
                    </Pressable>
                  )
                })}
              </View>
            </View>
          ) : null}

          <View style={styles.agreementRow}>
            <Pressable
              accessibilityLabel="同意服务协议和隐私政策"
              accessibilityRole="checkbox"
              accessibilityState={{ checked: agreed }}
              onPress={() => onAgreementChange(!agreed)}
              style={styles.checkboxHitArea}
            >
              <View style={[styles.checkbox, agreed && styles.checkboxChecked]}>
                {agreed ? (
                  <Check color={theme.color.text.inverse} size={15} strokeWidth={2.3} />
                ) : null}
              </View>
            </Pressable>
            <Text maxFontSizeMultiplier={1.3} style={styles.agreementText}>
              已阅读并同意
              <Text accessibilityRole="link" onPress={onOpenTerms} style={styles.agreementLink}>
                《服务协议》
              </Text>
              和
              <Text accessibilityRole="link" onPress={onOpenPrivacy} style={styles.agreementLink}>
                《隐私政策》
              </Text>
            </Text>
          </View>
        </ScrollView>
      </View>
    </View>
  )
}
