import {
  ChevronRight,
  Clock3,
  Home,
  ListTodo,
  LogIn,
  Monitor,
  Plus,
  Settings,
  UserRound,
  MessageCircleQuestion
} from 'lucide-react-native'
import type { ComponentType } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { OrcaLogo } from '../components/OrcaLogo'
import { productNameText } from '../product-brand'
import type { MobileTheme } from '../theme/mobile-theme'

interface MobileHomeDrawerProps {
  readonly theme: MobileTheme
  readonly visible: boolean
  readonly pairedComputerCount: number
  readonly canOpenHostActions: boolean
  readonly onClose: () => void
  readonly onAccount: () => void
  readonly onHome: () => void
  readonly onComputers: () => void
  readonly onNewWorkspace: () => void
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
  onHome,
  onComputers,
  onNewWorkspace,
  onTasks,
  onRecentWork,
  onSettings,
  onFeedback
}: MobileHomeDrawerProps) {
  const styles = createStyles(theme)
  const rows: readonly DrawerRow[] = [
    { key: 'home', label: '首页', Icon: Home, onPress: onHome },
    {
      key: 'computers',
      label: '已连接电脑',
      supporting: pairedComputerCount > 0 ? `${pairedComputerCount} 台` : '尚未配对',
      Icon: Monitor,
      onPress: onComputers
    },
    {
      key: 'workspace',
      label: '新建工作区',
      supporting: canOpenHostActions ? undefined : '连接电脑后可用',
      Icon: Plus,
      onPress: onNewWorkspace,
      disabled: !canOpenHostActions
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
        <View style={styles.panel}>
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              onPress={onAccount}
              style={({ pressed }) => [styles.accountEntry, pressed && styles.rowPressed]}
            >
              <View style={styles.avatar}>
                <OrcaLogo size={30} />
              </View>
              <View style={styles.accountCopy}>
                <Text style={styles.accountTitle}>{productNameText('登录 Orca')}</Text>
                <View style={styles.accountSupportingRow}>
                  <LogIn size={14} color={theme.color.text.secondary} />
                  <Text style={styles.accountSupporting}>登录后同步账号设置</Text>
                </View>
              </View>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="打开设置"
              onPress={onSettings}
              style={({ pressed }) => [styles.headerButton, pressed && styles.rowPressed]}
            >
              <Settings size={23} color={theme.color.text.primary} />
            </Pressable>
          </View>

          <View style={styles.rule} />
          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <View style={styles.navList}>
              {rows.map((row) => (
                <DrawerNavRow key={row.key} row={row} styles={styles} theme={theme} />
              ))}
            </View>
            <View style={styles.rule} />
            <View style={styles.navList}>
              <DrawerNavRow
                row={{ key: 'account', label: '账号', Icon: UserRound, onPress: onAccount }}
                styles={styles}
                theme={theme}
              />
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

          <Text style={styles.versionLabel}>{productNameText('Orca Mobile')}</Text>
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
      <row.Icon size={22} color={theme.color.text.primary} strokeWidth={1.9} />
      <View style={styles.rowCopy}>
        <Text style={styles.rowLabel}>{row.label}</Text>
        {row.supporting ? <Text style={styles.rowSupporting}>{row.supporting}</Text> : null}
      </View>
      <ChevronRight size={18} color={theme.color.text.tertiary} />
    </Pressable>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    backdrop: { flex: 1, flexDirection: 'row', backgroundColor: theme.color.overlay },
    backdropDismiss: { ...StyleSheet.absoluteFillObject },
    panel: {
      width: '82%',
      maxWidth: 340,
      height: '100%',
      paddingTop: 24,
      paddingHorizontal: theme.spacing.space20,
      paddingBottom: theme.spacing.space16,
      backgroundColor: theme.color.bg.surface,
      shadowColor: '#000000',
      shadowOpacity: 0.22,
      shadowRadius: 28,
      shadowOffset: { width: 12, height: 0 },
      elevation: 12
    },
    header: {
      minHeight: 64,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8
    },
    accountEntry: {
      minWidth: 0,
      minHeight: 56,
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space12,
      padding: theme.spacing.space4,
      borderRadius: theme.radii.control
    },
    avatar: {
      width: 48,
      height: 48,
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
      width: 44,
      height: 44,
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
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space8,
      borderRadius: theme.radii.card
    },
    rowCopy: { minWidth: 0, flex: 1 },
    rowLabel: { ...theme.typography.body, fontWeight: '500', color: theme.color.text.primary },
    rowSupporting: { ...theme.typography.caption, marginTop: 1, color: theme.color.text.secondary },
    rowPressed: { backgroundColor: theme.color.bg.subtle },
    rowDisabled: { opacity: 0.45 },
    versionLabel: {
      ...theme.typography.caption,
      paddingHorizontal: theme.spacing.space12,
      color: theme.color.text.tertiary
    }
  })
}
