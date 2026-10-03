import {
  ChevronRight,
  Clock3,
  ListTodo,
  LogIn,
  Monitor,
  Settings,
  MessageCircleQuestion
} from 'lucide-react-native'
import type { ComponentType } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { OrcaLogo } from '../components/OrcaLogo'
import { useMobileAuthSession } from '../auth/mobile-auth-session'
import { productNameText } from '../product-brand'
import type { MobileTheme } from '../theme/mobile-theme'
import { MobileDrawerApiQuota } from './MobileDrawerApiQuota'

interface MobileHomeDrawerProps {
  readonly theme: MobileTheme
  readonly visible: boolean
  readonly pairedComputerCount: number
  readonly canOpenHostActions: boolean
  readonly onClose: () => void
  readonly onAccount: () => void
  readonly onApiQuota: () => void
  readonly onManageDevices: () => void
  readonly onTasks: () => void
  readonly onRecentWork: () => void
  readonly onSettings: () => void
  readonly onFeedback: () => void
}

type DrawerRow = {
  readonly key: string
  readonly label: string
  readonly supporting?: string
  readonly Icon: ComponentType<{ size?: number; color?: string; strokeWidth?: number }>
  readonly onPress: () => void
  readonly disabled?: boolean
}

export function MobileHomeDrawer({
  theme,
  visible,
  pairedComputerCount,
  canOpenHostActions,
  onClose,
  onAccount,
  onApiQuota,
  onManageDevices,
  onTasks,
  onRecentWork,
  onSettings,
  onFeedback
}: MobileHomeDrawerProps) {
  const { hydrated, session } = useMobileAuthSession()
  const insets = useSafeAreaInsets()
  const styles = createStyles(theme)
  const rows: readonly DrawerRow[] = [
    {
      key: 'devices',
      label: '设备管理',
      supporting: pairedComputerCount > 0 ? `${pairedComputerCount} 台` : '尚未配对',
      Icon: Monitor,
      onPress: onManageDevices
    },
    {
      key: 'tasks',
      label: '任务中心',
      supporting: canOpenHostActions ? undefined : '连接电脑后可用',
      Icon: ListTodo,
      onPress: onTasks,
      disabled: !canOpenHostActions
    },
    {
      key: 'recent',
      label: '最近工作',
      supporting: canOpenHostActions ? undefined : '暂无记录',
      Icon: Clock3,
      onPress: onRecentWork,
      disabled: !canOpenHostActions
    }
  ]

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={styles.backdrop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭导航菜单"
          onPress={onClose}
          style={styles.backdropDismiss}
        />
        <View
          style={[
            styles.panel,
            {
              paddingTop: insets.top + theme.spacing.space16,
              paddingBottom: insets.bottom + theme.spacing.space16
            }
          ]}
        >
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              onPress={onAccount}
              style={({ pressed }) => [styles.accountEntry, pressed && styles.rowPressed]}
            >
              <View style={styles.avatar}>
                <OrcaLogo size={32} />
              </View>
              <View style={styles.accountCopy}>
                <Text maxFontSizeMultiplier={1.3} style={styles.accountTitle}>
                  {hydrated && session
                    ? session.account.displayName
                    : productNameText('登录 HiveCode')}
                </Text>
                <View style={styles.accountSupportingRow}>
                  <LogIn size={16} strokeWidth={2} color={theme.color.text.secondary} />
                  <Text maxFontSizeMultiplier={1.3} style={styles.accountSupporting}>
                    {hydrated && session ? '账号已同步' : '登录后同步账号设置'}
                  </Text>
                </View>
              </View>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="打开设置"
              onPress={onSettings}
              style={({ pressed }) => [styles.headerButton, pressed && styles.rowPressed]}
            >
              <Settings size={24} strokeWidth={2} color={theme.color.text.primary} />
            </Pressable>
          </View>

          <View style={styles.rule} />
          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            {visible && <MobileDrawerApiQuota theme={theme} onOpen={onApiQuota} />}
            <View style={styles.rule} />
            <View style={styles.navList}>
              {rows.map((row) => (
                <DrawerNavRow key={row.key} row={row} styles={styles} theme={theme} />
              ))}
            </View>
            <View style={styles.rule} />
            <View style={styles.navList}>
              <DrawerNavRow
                row={{
                  key: 'feedback',
                  label: '帮助与反馈',
                  Icon: MessageCircleQuestion,
                  onPress: onFeedback
                }}
                styles={styles}
                theme={theme}
              />
            </View>
          </ScrollView>

          <Text maxFontSizeMultiplier={1.3} style={styles.versionLabel}>
            {productNameText('Orca Mobile')}
          </Text>
        </View>
      </View>
    </Modal>
  )
}

function DrawerNavRow({
  row,
  styles,
  theme
}: {
  readonly row: DrawerRow
  readonly styles: ReturnType<typeof createStyles>
  readonly theme: MobileTheme
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: row.disabled }}
      disabled={row.disabled}
      onPress={row.onPress}
      style={({ pressed }) => [
        styles.navRow,
        row.disabled && styles.rowDisabled,
        pressed && styles.rowPressed
      ]}
    >
      <row.Icon size={24} color={theme.color.text.primary} strokeWidth={2} />
      <View style={styles.rowCopy}>
        <Text maxFontSizeMultiplier={1.3} style={styles.rowLabel}>
          {row.label}
        </Text>
        {row.supporting ? (
          <Text maxFontSizeMultiplier={1.3} style={styles.rowSupporting}>
            {row.supporting}
          </Text>
        ) : null}
      </View>
      <ChevronRight size={20} strokeWidth={2} color={theme.color.text.tertiary} />
    </Pressable>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    backdrop: { flex: 1, flexDirection: 'row', backgroundColor: theme.color.overlay },
    backdropDismiss: { ...StyleSheet.absoluteFillObject },
    panel: {
      width: '82%',
      maxWidth: theme.size.overlayMaxWidth,
      height: '100%',
      paddingHorizontal: theme.spacing.space20,
      backgroundColor: theme.color.bg.surface
    },
    header: {
      minHeight: theme.spacing.space64,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8
    },
    accountEntry: {
      minWidth: 0,
      minHeight: theme.size.groupedListRowMinHeight,
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space12,
      padding: theme.spacing.space4,
      borderRadius: theme.radii.control
    },
    avatar: {
      width: theme.spacing.space48,
      height: theme.spacing.space48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.circle,
      backgroundColor: theme.color.brand.subtle
    },
    accountCopy: { minWidth: 0, flex: 1 },
    accountTitle: { ...theme.typography.sectionTitle, color: theme.color.text.primary },
    accountSupportingRow: {
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4,
      marginTop: theme.spacing.space4
    },
    accountSupporting: {
      ...theme.typography.caption,
      minWidth: 0,
      flex: 1,
      color: theme.color.text.secondary
    },
    headerButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control
    },
    rule: {
      height: StyleSheet.hairlineWidth,
      marginVertical: theme.spacing.space16,
      backgroundColor: theme.color.border.subtle
    },
    body: { flexGrow: 1 },
    navList: { gap: theme.spacing.space4 },
    navRow: {
      minHeight: theme.size.groupedListRowMinHeight,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space8,
      borderRadius: theme.radii.card
    },
    rowCopy: { minWidth: 0, flex: 1 },
    rowLabel: { ...theme.typography.body, fontWeight: '500', color: theme.color.text.primary },
    rowSupporting: {
      ...theme.typography.caption,
      marginTop: theme.spacing.space4,
      color: theme.color.text.secondary
    },
    rowPressed: { backgroundColor: theme.color.bg.subtle },
    rowDisabled: { opacity: 0.45 },
    versionLabel: {
      ...theme.typography.caption,
      paddingHorizontal: theme.spacing.space12,
      color: theme.color.text.tertiary
    }
  })
}
