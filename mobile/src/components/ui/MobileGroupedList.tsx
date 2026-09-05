import { Children, isValidElement, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { MobileTheme } from '../../theme/mobile-theme'
import { useMobileThemeStyles } from '../../theme/mobile-theme-provider'

export function MobileGroupedList(props: {
  accessibilityLabel?: string
  children: ReactNode
  title?: string
}) {
  const styles = useMobileThemeStyles(createStyles)
  const rows = Children.toArray(props.children)
  return (
    <View accessibilityLabel={props.accessibilityLabel}>
      {props.title ? <Text style={styles.groupTitle}>{props.title}</Text> : null}
      <View style={styles.group}>
        {rows.map((row, index) => (
          <View key={isValidElement(row) ? row.key : String(row)}>
            {row}
            {index < rows.length - 1 ? <View style={styles.divider} /> : null}
          </View>
        ))}
      </View>
    </View>
  )
}

export function MobileGroupedListRow(props: {
  accessibilityLabel?: string
  detail?: string
  disabled?: boolean
  leading?: ReactNode
  onPress?: () => void
  title: string
  tone?: 'default' | 'danger'
  trailing?: ReactNode
  value?: string
}) {
  const styles = useMobileThemeStyles(createStyles)
  const content = (
    <>
      {props.leading ? <View style={styles.leading}>{props.leading}</View> : null}
      <View style={styles.rowBody}>
        <Text numberOfLines={1} style={[styles.rowTitle, props.tone === 'danger' && styles.danger]}>
          {props.title}
        </Text>
        {props.detail ? (
          <Text numberOfLines={2} style={styles.detail}>
            {props.detail}
          </Text>
        ) : null}
      </View>
      {props.value ? (
        <Text numberOfLines={1} style={styles.value}>
          {props.value}
        </Text>
      ) : null}
      {props.trailing ? <View style={styles.trailing}>{props.trailing}</View> : null}
    </>
  )

  if (!props.onPress) {
    return <View style={styles.row}>{content}</View>
  }

  return (
    <Pressable
      accessibilityLabel={props.accessibilityLabel ?? props.title}
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && styles.rowPressed,
        props.disabled && styles.disabled
      ]}
    >
      {content}
    </Pressable>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    groupTitle: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      marginBottom: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space4
    },
    group: {
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: theme.color.border.subtle,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface
    },
    divider: {
      height: 1,
      marginLeft: theme.spacing.space16,
      backgroundColor: theme.color.border.subtle
    },
    row: {
      minHeight: theme.size.groupedListRowMinHeight,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space12,
      gap: theme.spacing.space12
    },
    rowPressed: { backgroundColor: theme.color.bg.subtle },
    disabled: { opacity: 0.4 },
    leading: { width: 24, alignItems: 'center', justifyContent: 'center' },
    rowBody: { flex: 1, minWidth: 0 },
    rowTitle: { ...theme.typography.body, color: theme.color.text.primary },
    detail: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      marginTop: theme.spacing.space4
    },
    value: {
      ...theme.typography.meta,
      maxWidth: '40%',
      color: theme.color.text.secondary,
      textAlign: 'right'
    },
    trailing: { minWidth: 24, alignItems: 'flex-end', justifyContent: 'center' },
    danger: { color: theme.color.status.dangerText }
  })
}
