import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { Check, Monitor, Trash2 } from 'lucide-react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import type { RuntimeSelectorEntry, RuntimeSelectorTone } from './runtime-selector-presentation'
import type { createMobileRuntimeSelectorStyles as createStyles } from './mobile-runtime-selector-styles'

export function RuntimeGroup(props: {
  readonly entries: readonly RuntimeSelectorEntry[]
  readonly label: string
  readonly onDelete?: (entry: RuntimeSelectorEntry) => void
  readonly deletableIds?: readonly string[]
  readonly onSelect: (entry: RuntimeSelectorEntry) => void
  readonly pendingRuntimeId: string | null
  readonly styles: ReturnType<typeof createStyles>
  readonly theme: MobileTheme
}) {
  if (props.entries.length === 0) {
    return null
  }
  const deletableIds = new Set(props.deletableIds)
  return (
    <View style={props.styles.section}>
      <Text maxFontSizeMultiplier={1.3} style={props.styles.sectionTitle}>
        {props.label}
      </Text>
      <View style={props.styles.group}>
        {props.entries.map((entry, index) => (
          <View key={entry.id}>
            {index > 0 ? <View style={props.styles.separator} /> : null}
            <RuntimeRow
              entry={entry}
              disabled={!entry.selectable || props.pendingRuntimeId != null}
              pending={props.pendingRuntimeId === entry.id}
              onPress={() => props.onSelect(entry)}
              styles={props.styles}
              theme={props.theme}
            />
            {deletableIds.has(entry.id) ? (
              <Pressable
                accessibilityLabel={`删除 Runtime：${entry.name}`}
                accessibilityRole="button"
                onPress={() => props.onDelete?.(entry)}
                style={({ pressed }) => [
                  props.styles.deleteButton,
                  pressed && props.styles.pressed
                ]}
              >
                <Trash2 color={props.theme.color.status.dangerText} size={20} strokeWidth={2} />
                <Text maxFontSizeMultiplier={1.3} style={props.styles.deleteText}>
                  删除 Runtime
                </Text>
              </Pressable>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  )
}

function RuntimeRow(props: {
  readonly entry: RuntimeSelectorEntry
  readonly disabled: boolean
  readonly onPress: () => void
  readonly pending: boolean
  readonly styles: ReturnType<typeof createStyles>
  readonly theme: MobileTheme
}) {
  const statusColor = runtimeToneColor(props.entry.tone, props.theme)
  const statusTextColor = runtimeToneTextColor(props.entry.tone, props.theme)
  const connecting =
    props.pending || props.entry.statusLabel === '连接中' || props.entry.statusLabel === '正在重连'
  return (
    <Pressable
      accessibilityLabel={`${props.entry.name}，${props.entry.detail}，${props.entry.statusLabel}`}
      accessibilityRole="radio"
      accessibilityState={{
        busy: connecting,
        disabled: props.disabled,
        selected: props.entry.selected
      }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        props.styles.row,
        props.entry.selected && props.styles.rowSelected,
        props.disabled && !props.pending && props.styles.disabled,
        pressed && props.styles.pressed
      ]}
    >
      <View style={props.styles.runtimeIcon}>
        <Monitor color={props.theme.color.text.primary} size={22} strokeWidth={1.9} />
      </View>
      <View style={props.styles.rowCopy}>
        <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={props.styles.rowTitle}>
          {props.entry.name}
        </Text>
        <Text maxFontSizeMultiplier={1.3} numberOfLines={2} style={props.styles.rowDetail}>
          {props.entry.detail}
        </Text>
      </View>
      <View style={props.styles.status}>
        {connecting ? (
          <ActivityIndicator color={statusColor} size="small" />
        ) : (
          <View style={[props.styles.statusDot, { backgroundColor: statusColor }]} />
        )}
        <Text
          maxFontSizeMultiplier={1.3}
          numberOfLines={1}
          style={[props.styles.statusText, { color: statusTextColor }]}
        >
          {props.entry.statusLabel}
        </Text>
      </View>
      {props.entry.selected ? (
        <View style={props.styles.selectedIcon}>
          <Check color={props.theme.color.text.inverse} size={16} strokeWidth={2} />
        </View>
      ) : null}
    </Pressable>
  )
}

function runtimeToneColor(tone: RuntimeSelectorTone, theme: MobileTheme): string {
  if (tone === 'success') {
    return theme.color.status.success
  }
  if (tone === 'warning') {
    return theme.color.status.warning
  }
  return theme.color.text.tertiary
}

function runtimeToneTextColor(tone: RuntimeSelectorTone, theme: MobileTheme): string {
  if (tone === 'success') {
    return theme.color.status.successText
  }
  if (tone === 'warning') {
    return theme.color.status.warningText
  }
  return theme.color.text.secondary
}
