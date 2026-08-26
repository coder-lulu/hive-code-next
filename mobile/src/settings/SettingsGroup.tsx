import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ChevronRight, type LucideIcon } from 'lucide-react-native'
import { spacingTokens } from '../theme/mobile-theme'
import { useMobileTheme } from '../theme/mobile-theme-provider'

export interface SettingsGroupProps {
  readonly title: string
  readonly children: ReactNode
}

export function SettingsGroup({ title, children }: SettingsGroupProps) {
  const theme = useMobileTheme()
  return (
    <View>
      <Text
        style={[
          theme.typography.meta,
          { color: theme.color.text.secondary, marginBottom: theme.spacing.space8 }
        ]}
      >
        {title}
      </Text>
      <View
        style={{
          overflow: 'hidden',
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.color.border.default,
          borderRadius: theme.radii.card,
          backgroundColor: theme.color.bg.surface
        }}
      >
        {children}
      </View>
    </View>
  )
}

export interface SettingsRowProps {
  readonly icon: LucideIcon
  readonly label: string
  readonly detail?: string
  readonly value?: string
  readonly disabled?: boolean
  readonly last?: boolean
  readonly onPress?: () => void
}

export function SettingsRow({
  icon: Icon,
  label,
  detail,
  value,
  disabled = false,
  last = false,
  onPress
}: SettingsRowProps) {
  const theme = useMobileTheme()
  const content = (
    <>
      <Icon size={20} strokeWidth={1.8} color={theme.color.text.secondary} />
      <View style={styles.copy}>
        <Text style={[theme.typography.body, { color: theme.color.text.primary }]}>{label}</Text>
        {detail ? (
          <Text style={[theme.typography.caption, { color: theme.color.text.secondary }]}>
            {detail}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text
          numberOfLines={1}
          style={[styles.value, theme.typography.meta, { color: theme.color.text.tertiary }]}
        >
          {value}
        </Text>
      ) : null}
      {onPress ? (
        <ChevronRight size={20} strokeWidth={1.8} color={theme.color.text.tertiary} />
      ) : null}
    </>
  )
  const rowStyle = {
    minHeight: 56,
    paddingHorizontal: theme.spacing.space16,
    paddingVertical: theme.spacing.space12,
    borderBottomColor: theme.color.border.subtle,
    borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth
  }

  if (!onPress) {
    return (
      <View
        accessibilityState={{ disabled }}
        style={[styles.row, rowStyle, disabled && styles.dim]}
      >
        {content}
      </View>
    )
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      style={({ pressed }) => [
        styles.row,
        rowStyle,
        disabled && styles.dim,
        pressed && { backgroundColor: theme.color.bg.subtle }
      ]}
      onPress={onPress}
    >
      {content}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingTokens.space12
  },
  copy: { flex: 1, flexShrink: 1, gap: spacingTokens.space4 },
  value: { maxWidth: '42%', flexShrink: 1 },
  dim: { opacity: 0.58 }
})
