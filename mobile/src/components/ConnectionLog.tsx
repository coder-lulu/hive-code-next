import { CircleCheck, CircleX, Info, TriangleAlert, type LucideIcon } from 'lucide-react-native'
import { useRef } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import type { ConnectionLogEntry } from '../transport/types'

type Props = {
  entries: ConnectionLogEntry[]
  title?: string
}

const LEVEL_PRESENTATION: Record<
  ConnectionLogEntry['level'],
  { readonly icon: LucideIcon; readonly label: string }
> = {
  info: { icon: Info, label: '信息' },
  success: { icon: CircleCheck, label: '成功' },
  warn: { icon: TriangleAlert, label: '警告' },
  error: { icon: CircleX, label: '错误' }
}

function formatTime(ts: number, baseTs: number): string {
  const elapsed = Math.max(0, ts - baseTs) / 1000
  if (elapsed < 10) {
    return `+${elapsed.toFixed(2)}s`
  }
  if (elapsed < 100) {
    return `+${elapsed.toFixed(1)}s`
  }
  return `+${Math.round(elapsed)}s`
}

export function ConnectionLog({ entries, title }: Props) {
  const scrollRef = useRef<ScrollView | null>(null)
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)

  if (entries.length === 0) {
    return null
  }
  const baseTs = entries[0]!.ts

  return (
    <View style={styles.container}>
      {title ? (
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={styles.title}>
          {title}
        </Text>
      ) : null}
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {entries.map((entry) => {
          const elapsedTime = formatTime(entry.ts, baseTs)
          const presentation = LEVEL_PRESENTATION[entry.level]
          const Icon = presentation.icon
          const levelColor = getLevelColor(theme, entry.level)
          const accessibilityLabel = [elapsedTime, presentation.label, entry.message, entry.detail]
            .filter(Boolean)
            .join('，')

          return (
            <View
              accessible
              accessibilityLabel={accessibilityLabel}
              accessibilityRole="text"
              key={entry.id}
              style={styles.row}
            >
              <Text maxFontSizeMultiplier={1.3} style={styles.timestamp}>
                {elapsedTime}
              </Text>
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <Icon color={levelColor} size={16} strokeWidth={2} />
              </View>
              <View style={styles.rowText}>
                <Text maxFontSizeMultiplier={1.3} style={[styles.message, { color: levelColor }]}>
                  {entry.message}
                </Text>
                {entry.detail ? (
                  <Text maxFontSizeMultiplier={1.3} numberOfLines={2} style={styles.detail}>
                    {entry.detail}
                  </Text>
                ) : null}
              </View>
            </View>
          )
        })}
      </ScrollView>
    </View>
  )
}

function getLevelColor(theme: MobileTheme, level: ConnectionLogEntry['level']): string {
  switch (level) {
    case 'success':
      return theme.color.status.success
    case 'warn':
      return theme.color.status.warning
    case 'error':
      return theme.color.status.danger
    case 'info':
      return theme.color.text.secondary
  }
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    container: {
      width: '100%',
      maxHeight: theme.spacing.space64 * 4,
      flexShrink: 1,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space12
    },
    title: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      marginBottom: theme.spacing.space8
    },
    scroll: { flexShrink: 1 },
    scrollContent: { gap: theme.spacing.space8 },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.space8
    },
    timestamp: {
      ...theme.typography.code,
      width: theme.spacing.space64,
      flexShrink: 0,
      color: theme.color.text.tertiary
    },
    rowText: { flex: 1 },
    message: { ...theme.typography.code },
    detail: {
      ...theme.typography.caption,
      fontFamily: theme.typography.code.fontFamily,
      color: theme.color.text.tertiary,
      marginTop: theme.spacing.space4
    }
  })
}
