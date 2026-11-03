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
  return (
    <ActionSheetModal
      visible={props.visible}
      title="添加设备"
      message="选择一种方式连接电脑。扫码页面也支持输入配对码。"
      onClose={props.onClose}
      actions={[
        {
          label: '扫码或配对码连接',
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
  const styles = createMobileDevicesStyles(props.theme)
  return (
    <BottomDrawer visible={props.visible} onClose={props.onClose}>
      <View style={styles.deviceHeader}>
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={styles.sheetTitle}>
          连接帮助
        </Text>
        <MobileIconButton accessibilityLabel="关闭连接帮助" icon={X} onPress={props.onClose} />
      </View>
      {(['scan', 'account'] as const).map((method) => (
        <View key={method} style={styles.helpSection}>
          <Text maxFontSizeMultiplier={1.3} style={styles.deviceName}>
            {method === 'scan' ? '扫码或配对码连接' : 'HiveCloud 账号连接'}
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
              配对码可在扫码页面输入。手机需要能访问电脑地址；可使用局域网、Tailscale
              或自行配置可达网络。
            </Text>
          ) : null}
        </View>
      ))}
    </BottomDrawer>
  )
}
