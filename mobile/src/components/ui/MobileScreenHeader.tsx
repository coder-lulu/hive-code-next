import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { MobileTheme } from '../../theme/mobile-theme'
import { useMobileThemeStyles } from '../../theme/mobile-theme-provider'

export function MobileScreenHeader(props: {
  leading?: ReactNode
  title: string
  titleAlign?: 'center' | 'left'
  trailing?: ReactNode
}) {
  const styles = useMobileThemeStyles(createStyles)
  const titleAlign = props.titleAlign ?? 'center'
  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <View style={styles.header}>
        <View style={styles.side}>{props.leading}</View>
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={1.3}
          numberOfLines={1}
          style={[styles.title, titleAlign === 'left' && styles.titleLeft]}
        >
          {props.title}
        </Text>
        <View style={styles.side}>{props.trailing}</View>
      </View>
    </SafeAreaView>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    safeArea: { backgroundColor: theme.color.bg.canvas },
    header: {
      height: theme.size.navigationBarHeight,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.space20,
      backgroundColor: theme.color.bg.canvas
    },
    side: {
      width: theme.size.minimumTouchTarget,
      minHeight: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center'
    },
    title: {
      ...theme.typography.pageTitle,
      flex: 1,
      color: theme.color.text.primary,
      textAlign: 'center'
    },
    titleLeft: { textAlign: 'left' }
  })
}
