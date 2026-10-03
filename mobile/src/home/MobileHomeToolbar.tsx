import { useMemo } from 'react'
import { ArrowLeft, Menu, RefreshCw } from 'lucide-react-native'
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { APP_DISPLAY_NAME } from '../product-brand'
import { OrcaLogo } from '../components/OrcaLogo'
import type { MobileTheme } from '../theme/mobile-theme'

interface MobileHomeToolbarProps {
  readonly theme: MobileTheme
  readonly onOpenMenu?: () => void
  readonly onBack?: () => void
  readonly onRefresh?: () => void
  readonly refreshing?: boolean
}

export function MobileHomeToolbar({
  theme,
  onOpenMenu,
  onBack,
  onRefresh,
  refreshing = false
}: MobileHomeToolbarProps) {
  const { width } = useWindowDimensions()
  const compact = width < theme.size.compactLayoutBreakpoint
  const styles = useMemo(() => createStyles(theme, compact), [compact, theme])
  return (
    <View style={styles.toolbar}>
      <View style={styles.sideSlot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={onBack ? '返回' : '打开导航菜单'}
          onPress={onBack ?? onOpenMenu}
          style={({ pressed }) => [styles.menuButton, pressed && styles.pressed]}
        >
          {onBack ? (
            <ArrowLeft color={theme.color.text.primary} size={24} strokeWidth={2} />
          ) : (
            <Menu color={theme.color.text.primary} size={24} strokeWidth={2} />
          )}
        </Pressable>
      </View>

      <View
        accessible
        accessibilityRole="header"
        accessibilityLabel={APP_DISPLAY_NAME}
        style={styles.titleBlock}
      >
        <OrcaLogo size={24} />
        {!compact ? (
          <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.title}>
            {APP_DISPLAY_NAME}
          </Text>
        ) : null}
      </View>

      <View style={[styles.sideSlot, styles.trailingSlot]}>
        {onRefresh ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="刷新设备"
            accessibilityState={{ busy: refreshing, disabled: refreshing }}
            disabled={refreshing}
            onPress={onRefresh}
            style={({ pressed }) => [styles.refreshButton, pressed && styles.pressed]}
          >
            <RefreshCw size={20} strokeWidth={2} color={theme.color.text.primary} />
            <Text maxFontSizeMultiplier={1.3} style={styles.runtimeLabel}>
              {refreshing ? '刷新中' : '刷新'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

function createStyles(theme: MobileTheme, compact: boolean) {
  return StyleSheet.create({
    toolbar: {
      minHeight: theme.size.navigationBarHeight,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.space16,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border.subtle,
      backgroundColor: theme.color.bg.surface
    },
    sideSlot: { minWidth: 0, flex: 1, alignItems: 'flex-start' },
    trailingSlot: { alignItems: 'flex-end' },
    menuButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface
    },
    pressed: { backgroundColor: theme.color.bg.subtle },
    titleBlock: {
      width: compact
        ? theme.size.minimumTouchTarget
        : theme.spacing.space64 * 2 + theme.spacing.space8,
      flexDirection: 'row',
      gap: theme.spacing.space4,
      alignItems: 'center',
      justifyContent: 'center'
    },
    title: {
      minWidth: 0,
      flexShrink: 1,
      ...theme.typography.pageTitle,
      fontSize: compact ? theme.typography.body.fontSize : theme.typography.pageTitle.fontSize,
      lineHeight: compact
        ? theme.typography.body.lineHeight
        : theme.typography.pageTitle.lineHeight,
      color: theme.color.text.primary
    },
    runtimeLabel: {
      ...theme.typography.label,
      minWidth: 0,
      flexShrink: 1,
      color: theme.color.text.primary
    },
    refreshButton: {
      minHeight: theme.size.minimumTouchTarget,
      minWidth: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space8,
      borderRadius: theme.radii.control
    }
  })
}
