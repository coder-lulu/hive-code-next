import { productNameText } from '../product-brand'
import { Keyboard, MonitorUp, QrCode, ShieldCheck } from 'lucide-react-native'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

interface MobileComputerEmptyStateProps {
  readonly theme: MobileTheme
  readonly bottomInset: number
  readonly maxWidth?: number
  readonly onScan: () => void
  readonly onEnterCode: () => void
}

export function MobileComputerEmptyState({
  theme,
  bottomInset,
  maxWidth,
  onScan,
  onEnterCode
}: MobileComputerEmptyStateProps) {
  const styles = createStyles(theme)

  return (
    <View
      style={[
        styles.screen,
        { paddingBottom: bottomInset + theme.spacing.space16 },
        maxWidth ? { maxWidth, width: '100%', alignSelf: 'center' } : null
      ]}
      testID="computer-empty-state"
    >
      <View style={styles.hero}>
        <View style={styles.computerMark}>
          <MonitorUp size={46} color={theme.color.text.primary} strokeWidth={1.7} />
        </View>
        <Text style={styles.title}>连接你的电脑</Text>
        <Text style={styles.body}>
          {productNameText('在电脑版 Orca 生成配对二维码，连接后即可查看 Agent、终端和工作区。')}
        </Text>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={onScan}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          >
            <QrCode size={18} color={theme.color.text.inverse} />
            <Text style={styles.primaryButtonText}>扫描二维码</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={onEnterCode}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          >
            <Keyboard size={18} color={theme.color.text.primary} />
            <Text style={styles.secondaryButtonText}>输入配对码</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.guideCard}>
        <Text style={styles.guideEyebrow}>连接方法</Text>
        <Text style={styles.guideTitle}>电脑版设置 → 移动端 → 生成配对码</Text>
        <View style={styles.securityRow}>
          <ShieldCheck size={17} color={theme.color.status.success} />
          <Text style={styles.securityText}>配对凭据保存在本机，通信使用端到端加密</Text>
        </View>
      </View>
    </View>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      justifyContent: 'space-between',
      gap: theme.spacing.space24,
      paddingHorizontal: theme.spacing.space20,
      paddingTop: theme.spacing.space32,
      backgroundColor: theme.color.bg.canvas
    },
    hero: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    computerMark: {
      width: 104,
      height: 104,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: theme.spacing.space24,
      borderRadius: theme.radii.circle,
      backgroundColor: theme.color.bg.subtle
    },
    title: {
      ...theme.typography.pageTitle,
      color: theme.color.text.primary,
      textAlign: 'center'
    },
    body: {
      ...theme.typography.body,
      maxWidth: 330,
      marginTop: theme.spacing.space8,
      color: theme.color.text.secondary,
      textAlign: 'center'
    },
    actions: {
      width: '100%',
      maxWidth: 330,
      gap: theme.spacing.space8,
      marginTop: theme.spacing.space32
    },
    primaryButton: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space8,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.selected
    },
    primaryButtonText: {
      ...theme.typography.label,
      color: theme.color.text.inverse,
      fontWeight: '600'
    },
    secondaryButton: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space8,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface
    },
    secondaryButtonText: {
      ...theme.typography.label,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    pressed: { opacity: 0.74, transform: [{ scale: 0.99 }] },
    guideCard: {
      gap: theme.spacing.space8,
      padding: theme.spacing.space16,
      borderWidth: 1,
      borderColor: theme.color.border.subtle,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface
    },
    guideEyebrow: {
      ...theme.typography.caption,
      color: theme.color.text.tertiary,
      fontWeight: '600'
    },
    guideTitle: { ...theme.typography.label, color: theme.color.text.primary },
    securityRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      paddingTop: theme.spacing.space4
    },
    securityText: { ...theme.typography.caption, flex: 1, color: theme.color.text.secondary }
  })
}
