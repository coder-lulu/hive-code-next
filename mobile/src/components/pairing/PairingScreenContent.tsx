import type { LucideIcon } from 'lucide-react-native'
import { LockKeyhole } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import type { MobileTheme } from '../../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../../theme/mobile-theme-provider'

export function PairingScreenContent(props: {
  children?: ReactNode
  description: string
  icon: LucideIcon
  title: string
  tone?: 'default' | 'danger'
}) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const Icon = props.icon
  const danger = props.tone === 'danger'
  return (
    <View style={styles.content}>
      <View style={[styles.iconFrame, danger && styles.iconFrameDanger]}>
        <Icon
          color={danger ? theme.color.status.danger : theme.color.text.secondary}
          size={44}
          strokeWidth={1.75}
        />
      </View>
      <Text accessibilityRole="header" style={[styles.title, danger && styles.dangerText]}>
        {props.title}
      </Text>
      <Text style={styles.description}>{props.description}</Text>
      {props.children}
    </View>
  )
}

export function PairingSecurityNotice() {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  return (
    <View accessibilityRole="text" style={styles.securityNotice}>
      <LockKeyhole color={theme.color.status.success} size={16} strokeWidth={2} />
      <Text style={styles.securityText}>配对凭据保存在本机，通信使用端到端加密</Text>
    </View>
  )
}

export function PairingConnectingState(props: {
  children?: ReactNode
  description?: string
  title?: string
}) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  return (
    <View style={styles.connecting}>
      <ActivityIndicator color={theme.color.text.secondary} size="large" />
      <Text accessibilityRole="header" style={styles.connectingTitle}>
        {props.title ?? '正在建立安全连接'}
      </Text>
      <Text style={styles.description}>{props.description ?? '正在验证设备与配对凭据…'}</Text>
      {props.children}
    </View>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    content: { width: '100%', maxWidth: 400, alignItems: 'center' },
    iconFrame: {
      width: 96,
      height: 96,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface,
      marginBottom: theme.spacing.space24
    },
    iconFrameDanger: {
      borderColor: theme.color.status.danger,
      backgroundColor: theme.color.bg.surface
    },
    title: {
      ...theme.typography.pageTitle,
      color: theme.color.text.primary,
      textAlign: 'center'
    },
    dangerText: { color: theme.color.status.danger },
    description: {
      ...theme.typography.meta,
      maxWidth: 340,
      color: theme.color.text.secondary,
      textAlign: 'center',
      marginTop: theme.spacing.space8
    },
    securityNotice: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space8,
      marginTop: theme.spacing.space16,
      paddingHorizontal: theme.spacing.space12
    },
    securityText: {
      ...theme.typography.caption,
      flexShrink: 1,
      color: theme.color.text.secondary,
      textAlign: 'center'
    },
    connecting: { width: '100%', maxWidth: 400, alignItems: 'center' },
    connectingTitle: {
      ...theme.typography.sectionTitle,
      color: theme.color.text.primary,
      marginTop: theme.spacing.space20,
      textAlign: 'center'
    }
  })
}
