import { useMobileTranslation } from '../i18n/use-mobile-translation'
import { ScanLine, UserRound, X } from 'lucide-react-native'
import { Text, View } from 'react-native'
import { ActionSheetModal } from '../components/ActionSheetModal'
import { BottomDrawer } from '../components/BottomDrawer'
import { MobileIconButton } from '../components/ui/MobileIconButton'
import { mobileHomeConnectionContent } from '../home/mobile-home-connection-content'
import type { MobileTheme } from '../theme/mobile-theme'
import { createMobileDevicesStyles } from './mobile-devices-styles'

export function MobileDeviceAddMenu(props: {
  visible: boolean
  hydrated: boolean
  signedIn: boolean
  onClose: () => void
  onPair: () => void
  onAccount: () => void
}) {
  const t = useMobileTranslation()

  return (
    <ActionSheetModal
      visible={props.visible}
      title={t('auto.mobile.src.devices.MobileDeviceMenus.c8aa6cacfd', 'Add device')}
      message={t(
        'auto.mobile.src.devices.MobileDeviceMenus.df0d3eca67',
        'Choose how to connect to a computer. You can also enter a pairing code on the scan page.'
      )}
      onClose={props.onClose}
      actions={[
        {
          label: t(
            'auto.mobile.src.devices.MobileDeviceMenus.3f41e93205',
            'Connect with QR code or pairing code'
          ),
          icon: ScanLine,
          closeBeforePress: true,
          onPress: props.onPair
        },
        {
          label: props.signedIn ? '认领账号电脑' : '登录 HiveCloud',
          icon: UserRound,
          disabled: !props.hydrated,
          closeBeforePress: true,
          onPress: props.onAccount
        }
      ]}
    />
  )
}

export function MobileDeviceHelpSheet(props: {
  visible: boolean
  onClose: () => void
  theme: MobileTheme
}) {
  const t = useMobileTranslation()

  const styles = createMobileDevicesStyles(props.theme)
  return (
    <BottomDrawer visible={props.visible} onClose={props.onClose}>
      <View style={styles.deviceHeader}>
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={styles.sheetTitle}>
          {t('auto.mobile.src.devices.MobileDeviceMenus.02e72901c5', 'Connection help')}
        </Text>
        <MobileIconButton
          accessibilityLabel={t(
            'auto.mobile.src.devices.MobileDeviceMenus.efb8344e59',
            'Close connection help'
          )}
          icon={X}
          onPress={props.onClose}
        />
      </View>
      {(['scan', 'account'] as const).map((method) => (
        <View key={method} style={styles.helpSection}>
          <Text maxFontSizeMultiplier={1.3} style={styles.deviceName}>
            {method === 'scan'
              ? t(
                  'auto.mobile.src.devices.MobileDeviceMenus.3f41e93205',
                  'Connect with QR code or pairing code'
                )
              : t(
                  'auto.mobile.src.devices.MobileDeviceMenus.00e21629b6',
                  'HiveCloud account connection'
                )}
          </Text>
          {mobileHomeConnectionContent[method].steps.map((step) => (
            <View key={step.title}>
              <Text maxFontSizeMultiplier={1.3} style={styles.deviceName}>
                {step.title}
              </Text>
              <Text maxFontSizeMultiplier={1.3} style={styles.deviceMeta}>
                {step.description}
              </Text>
            </View>
          ))}
          {method === 'scan' ? (
            <Text maxFontSizeMultiplier={1.3} style={styles.deviceMeta}>
              {t(
                'auto.mobile.src.devices.MobileDeviceMenus.6bcbbb7519',
                'Enter pairing codes on the scan page. Your phone must be able to reach the computer’s address using a local network, Tailscale, or your own reachable network.'
              )}
            </Text>
          ) : null}
        </View>
      ))}
    </BottomDrawer>
  )
}
