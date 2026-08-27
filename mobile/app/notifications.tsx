import { productNameText } from '@/product-brand'
import { useCallback, useEffect, useState } from 'react'
import {
  AppState,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View
} from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { ChevronLeft, Settings } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MobileGroupedList, MobileIconButton, MobileScreenHeader } from '../src/components/ui'
import {
  ensureNotificationPermissions,
  getNotificationPermissionState,
  type NotificationPermissionState
} from '../src/notifications/mobile-notifications'
import {
  loadPushNotificationsEnabled,
  savePushNotificationsEnabled
} from '../src/storage/preferences'
import type { MobileTheme } from '../src/theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../src/theme/mobile-theme-provider'

const DEFAULT_PERMISSION_STATE: NotificationPermissionState = {
  granted: false,
  status: 'undetermined',
  canAskAgain: true,
  authorizationReflectsUserChoice: false
}

export default function NotificationsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [permissionState, setPermissionState] = useState(DEFAULT_PERMISSION_STATE)

  const refreshSettings = useCallback(async () => {
    const [enabled, permission] = await Promise.all([
      loadPushNotificationsEnabled(),
      getNotificationPermissionState()
    ])
    setPushEnabled(enabled)
    setPermissionState(permission)
  }, [])

  useFocusEffect(
    useCallback(() => {
      void refreshSettings()
    }, [refreshSettings])
  )

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refreshSettings()
      }
    })
    return () => subscription.remove()
  }, [refreshSettings])

  const togglePush = async (value: boolean) => {
    if (value) {
      const granted = await ensureNotificationPermissions()
      const permission = await getNotificationPermissionState()
      setPermissionState(permission)
      if (!granted) {
        setPushEnabled(false)
        await savePushNotificationsEnabled(false)
        return
      }
    }
    setPushEnabled(value)
    await savePushNotificationsEnabled(value)
  }

  const switchEnabled = pushEnabled && permissionState.granted
  const notificationsBlocked = permissionState.status === 'denied'
  const hint = notificationsBlocked
    ? productNameText('系统设置中已关闭通知权限。Orca 不会在无权限时保留开启状态。')
    : '当智能体需要你处理问题或完成任务时，在此设备上接收通知。'

  return (
    <View style={styles.screen}>
      <MobileScreenHeader
        leading={
          <MobileIconButton
            accessibilityLabel="返回"
            icon={ChevronLeft}
            iconSize={24}
            onPress={() => router.back()}
          />
        }
        title="通知"
      />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + theme.spacing.space32 }
        ]}
        showsVerticalScrollIndicator={false}
      >
        <MobileGroupedList title="推送通知">
          <View style={styles.row}>
            <View style={styles.rowCopy}>
              <Text maxFontSizeMultiplier={1.3} style={styles.rowTitle}>
                智能体通知
              </Text>
              <Text maxFontSizeMultiplier={1.3} style={styles.rowStatus}>
                {switchEnabled ? '已开启' : notificationsBlocked ? '权限已关闭' : '已关闭'}
              </Text>
            </View>
            <Switch
              accessibilityLabel="智能体通知"
              accessibilityState={{ disabled: notificationsBlocked }}
              value={switchEnabled}
              disabled={notificationsBlocked}
              onValueChange={(value) => void togglePush(value)}
              trackColor={{
                false: theme.color.bg.subtle,
                true: theme.color.bg.selected
              }}
              thumbColor={switchEnabled ? theme.color.text.inverse : theme.color.text.secondary}
            />
          </View>
          <View style={styles.detailArea}>
            <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.3} style={styles.hint}>
              {hint}
            </Text>
            {notificationsBlocked ? (
              <Pressable
                accessibilityLabel="打开系统通知设置"
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.settingsButton,
                  pressed && styles.settingsButtonPressed
                ]}
                onPress={() => void Linking.openSettings()}
              >
                <Settings color={theme.color.text.secondary} size={20} strokeWidth={2} />
                <Text maxFontSizeMultiplier={1.3} style={styles.settingsButtonText}>
                  打开系统设置
                </Text>
              </Pressable>
            ) : null}
          </View>
        </MobileGroupedList>
      </ScrollView>
    </View>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.color.bg.canvas },
    content: {
      paddingHorizontal: theme.spacing.space20,
      paddingTop: theme.spacing.space20
    },
    row: {
      minHeight: theme.size.groupedListRowMinHeight,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space12
    },
    rowCopy: { minWidth: 0, flex: 1, gap: theme.spacing.space4 },
    rowTitle: { ...theme.typography.body, color: theme.color.text.primary },
    rowStatus: { ...theme.typography.meta, color: theme.color.text.secondary },
    detailArea: {
      gap: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space12
    },
    hint: { ...theme.typography.meta, color: theme.color.text.secondary },
    settingsButton: {
      minHeight: theme.size.minimumTouchTarget,
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space12,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface
    },
    settingsButtonPressed: { backgroundColor: theme.color.bg.subtle },
    settingsButtonText: { ...theme.typography.label, color: theme.color.text.primary }
  })
}
