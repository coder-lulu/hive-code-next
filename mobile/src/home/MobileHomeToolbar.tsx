import { Menu } from 'lucide-react-native'
import { useEffect } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming
} from 'react-native-reanimated'
import { useReducedMotionEnabled } from '../hooks/use-reduced-motion-enabled'
import type { MobileTheme } from '../theme/mobile-theme'
import type { MobileHomeMode } from './mobile-home-mode'

interface MobileHomeToolbarProps {
  readonly theme: MobileTheme
  readonly mode: MobileHomeMode
  readonly hasConnectedComputer: boolean
  readonly onOpenMenu: () => void
  readonly onChangeMode: (mode: MobileHomeMode) => void
}

export function MobileHomeToolbar({
  theme,
  mode,
  hasConnectedComputer,
  onOpenMenu,
  onChangeMode
}: MobileHomeToolbarProps) {
  const styles = createStyles(theme)
  const reducedMotionEnabled = useReducedMotionEnabled()
  const activeSegmentX = useSharedValue(mode === 'computer' ? 92 : 0)

  useEffect(() => {
    activeSegmentX.value = withTiming(mode === 'computer' ? 92 : 0, {
      duration: reducedMotionEnabled ? 0 : 180,
      easing: Easing.out(Easing.cubic)
    })
  }, [activeSegmentX, mode, reducedMotionEnabled])

  const activeSegmentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: activeSegmentX.value }]
  }))

  return (
    <View style={styles.toolbar}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="打开导航菜单"
        hitSlop={4}
        onPress={onOpenMenu}
        style={({ pressed }) => [styles.menuButton, pressed && styles.pressed]}
      >
        <Menu size={22} color={theme.color.text.primary} strokeWidth={2.1} />
      </Pressable>

      <View accessibilityRole="tablist" style={styles.segmentedControl}>
        <Animated.View style={[styles.segmentIndicator, activeSegmentStyle]} />
        <ModeOption
          active={mode === 'cloud'}
          icon="none"
          label="云端工作"
          onPress={() => onChangeMode('cloud')}
          theme={theme}
        />
        <ModeOption
          active={mode === 'computer'}
          icon="computer"
          label="连接电脑"
          online={hasConnectedComputer}
          onPress={() => onChangeMode('computer')}
          theme={theme}
        />
      </View>
    </View>
  )
}

function ModeOption({
  active,
  icon,
  label,
  online = false,
  onPress,
  theme
}: {
  readonly active: boolean
  readonly icon: 'none' | 'computer'
  readonly label: string
  readonly online?: boolean
  readonly onPress: () => void
  readonly theme: MobileTheme
}) {
  const styles = createStyles(theme)
  const foreground = active ? theme.color.text.inverse : theme.color.text.secondary
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.segment, pressed && styles.segmentPressed]}
    >
      {icon === 'computer' ? (
        <View style={[styles.onlineDot, !online && styles.offlineDot]} />
      ) : null}
      <Text numberOfLines={1} style={[styles.segmentLabel, { color: foreground }]}>
        {label}
      </Text>
    </Pressable>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    toolbar: {
      minHeight: 60,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space20,
      paddingVertical: theme.spacing.space8,
      backgroundColor: theme.color.bg.canvas
    },
    menuButton: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.circle,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      backgroundColor: theme.color.bg.surface,
      shadowColor: '#000000',
      shadowOpacity: theme.scheme === 'dark' ? 0.22 : 0.08,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 5 },
      elevation: 2
    },
    pressed: { opacity: 0.72, transform: [{ scale: 0.97 }] },
    segmentedControl: {
      width: 190,
      height: 44,
      flexDirection: 'row',
      alignItems: 'center',
      padding: 3,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      backgroundColor: theme.color.bg.subtle
    },
    segment: {
      minWidth: 0,
      height: 36,
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space4,
      paddingHorizontal: theme.spacing.space8,
      borderRadius: theme.radii.control
    },
    segmentIndicator: {
      position: 'absolute',
      top: 3,
      left: 3,
      width: 92,
      height: 36,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.selected
    },
    segmentPressed: { opacity: 0.78 },
    segmentLabel: { ...theme.typography.meta, fontWeight: '600' },
    onlineDot: {
      width: 7,
      height: 7,
      borderRadius: theme.radii.circle,
      backgroundColor: theme.color.status.success
    },
    offlineDot: {
      backgroundColor: theme.color.status.danger
    }
  })
}
