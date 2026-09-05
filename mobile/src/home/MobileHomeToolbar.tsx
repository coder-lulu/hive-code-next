import { useMemo } from 'react'
import { ChevronDown, Menu } from 'lucide-react-native'
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { APP_DISPLAY_NAME } from '../product-brand'
import type { MobileTheme } from '../theme/mobile-theme'

interface MobileHomeToolbarProps {
  readonly theme: MobileTheme
  readonly runtimeName: string | null
  readonly onOpenMenu: () => void
  readonly onOpenRuntimeSelector: () => void
}

export function MobileHomeToolbar({
  theme,
  runtimeName,
  onOpenMenu,
  onOpenRuntimeSelector
}: MobileHomeToolbarProps) {
  const { width } = useWindowDimensions()
  const compact = width < theme.size.compactLayoutBreakpoint
  const styles = useMemo(() => createStyles(theme, compact), [compact, theme])
  return (
    <View style={styles.toolbar}>
      <View style={[styles.sideSlot, compact && styles.leadingSlotCompact]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="打开导航菜单"
          onPress={onOpenMenu}
          style={({ pressed }) => [styles.menuButton, pressed && styles.pressed]}
        >
          <Menu color={theme.color.text.primary} size={22} strokeWidth={2} />
        </Pressable>
      </View>

      <View style={styles.titleBlock}>
        <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.title}>
          {APP_DISPLAY_NAME}
        </Text>
      </View>

      <View style={[styles.sideSlot, styles.trailingSlot]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`选择 Runtime，当前${runtimeName ? `为 ${runtimeName}` : '未选择'}`}
          onPress={onOpenRuntimeSelector}
          style={({ pressed }) => [styles.runtimeButton, pressed && styles.pressed]}
        >
          <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.runtimeLabel}>
            连接电脑
          </Text>
          <ChevronDown color={theme.color.text.secondary} size={16} strokeWidth={2} />
        </Pressable>
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
    leadingSlotCompact: { width: theme.size.minimumTouchTarget, flex: 0 },
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
      width: theme.spacing.space64 + theme.spacing.space48,
      alignItems: 'center',
      justifyContent: 'center'
    },
    title: {
      ...theme.typography.pageTitle,
      fontSize: compact ? theme.typography.body.fontSize : theme.typography.pageTitle.fontSize,
      lineHeight: compact
        ? theme.typography.body.lineHeight
        : theme.typography.pageTitle.lineHeight,
      color: theme.color.text.primary
    },
    runtimeButton: {
      minWidth: theme.size.minimumTouchTarget,
      maxWidth: compact ? '100%' : theme.spacing.space64 * 2 + theme.spacing.space40,
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: theme.spacing.space4,
      paddingHorizontal: theme.spacing.space8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface
    },
    runtimeLabel: {
      ...theme.typography.label,
      minWidth: 0,
      flexShrink: 1,
      color: theme.color.text.primary
    }
  })
}
