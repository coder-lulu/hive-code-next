import { useEffect, useRef } from 'react'
import { Animated, StyleSheet, Text, View } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileThemeStyles } from '../theme/mobile-theme-provider'

/** Animated three-dot "agent is working" row, shown while the active agent is
 *  still producing a reply. Pure presentation — visibility is the caller's call. */
export function MobileAgentWorkingIndicator(): React.JSX.Element {
  const styles = useMobileThemeStyles(createStyles)
  const dots = useRef([
    { id: 'first', opacity: new Animated.Value(0.3) },
    { id: 'second', opacity: new Animated.Value(0.3) },
    { id: 'third', opacity: new Animated.Value(0.3) }
  ]).current

  useEffect(() => {
    const animations = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(dot.opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
          Animated.timing(dot.opacity, { toValue: 0.3, duration: 200, useNativeDriver: true })
        ])
      )
    )
    animations.forEach((a) => a.start())
    return () => animations.forEach((a) => a.stop())
  }, [dots])

  return (
    <View
      accessible
      accessibilityLabel="Agent 正在工作"
      accessibilityLiveRegion="polite"
      accessibilityRole="text"
      style={styles.row}
    >
      <Text maxFontSizeMultiplier={1.3} style={styles.label}>
        Agent 正在工作
      </Text>
      <View style={styles.dots}>
        {dots.map((dot) => (
          <Animated.View key={dot.id} style={[styles.dot, { opacity: dot.opacity }]} />
        ))}
      </View>
    </View>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space8
    },
    label: {
      ...theme.typography.meta,
      color: theme.color.text.tertiary
    },
    dots: {
      flexDirection: 'row',
      gap: theme.spacing.space4
    },
    dot: {
      width: theme.spacing.space4,
      height: theme.spacing.space4,
      borderRadius: theme.radii.circle,
      backgroundColor: theme.color.brand.primary
    }
  })
}
