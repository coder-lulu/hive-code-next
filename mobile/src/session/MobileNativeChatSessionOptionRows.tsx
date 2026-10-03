// The pill and choice-row primitives the session-option card is built from, kept
// beside it so the card file stays about layout and apply wiring.

import { Pressable, StyleSheet, Switch, Text, View } from 'react-native'
import { Check, ChevronDown, ChevronRight } from 'lucide-react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import {
  sessionOptionValueMarker,
  type SessionOptionDescriptor,
  type SessionOptionValueMarker,
  type SessionOptionValue
} from '../../../src/shared/native-chat-session-options'

/** Muted one-liner above a group — dispatch state, or why a row is locked. */
export function SessionOptionCaption({ children }: { children: string }): React.JSX.Element {
  const styles = useMobileThemeStyles(createStyles)
  return <Text style={styles.caption}>{children}</Text>
}

export function Pill({
  label,
  accessibleName,
  disabled,
  onPress
}: {
  label: string
  accessibleName: string
  disabled: boolean
  onPress: () => void
}): React.JSX.Element {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  return (
    <Pressable
      accessibilityLabel={accessibleName}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.pill, pressed && !disabled && styles.pressed]}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
    >
      <Text
        style={[styles.pillText, disabled && styles.pillTextDisabled]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {label}
      </Text>
      <ChevronDown
        size={16}
        color={disabled ? theme.color.text.tertiary : theme.color.text.secondary}
      />
    </Pressable>
  )
}

function ChoiceRow({
  label,
  description,
  selected,
  disabled,
  grouped,
  divided,
  onPress
}: {
  label: string
  description?: string
  selected: boolean
  disabled: boolean
  grouped: boolean
  divided: boolean
  onPress: () => void
}): React.JSX.Element {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      style={[
        styles.row,
        selected && styles.rowSelected,
        grouped && styles.rowGrouped,
        divided && styles.rowDivided,
        disabled && styles.rowDisabled
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <View style={[styles.radio, selected && styles.radioOn]}>
        {selected ? <Check size={12} color={theme.color.text.inverse} strokeWidth={3} /> : null}
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel}>{label}</Text>
        {description ? (
          <Text style={styles.rowDescription} numberOfLines={2}>
            {description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  )
}

function ToggleRow({
  label,
  checked,
  marker,
  disabled,
  grouped,
  onToggle
}: {
  label: string
  checked: boolean
  /** Where the rendered value came from, or null once something picked it. */
  marker: SessionOptionValueMarker | null
  disabled: boolean
  grouped: boolean
  onToggle: (next: boolean) => void
}): React.JSX.Element {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  return (
    <View style={[styles.row, grouped && styles.rowGrouped, disabled && styles.rowDisabled]}>
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      {marker ? (
        <Text style={styles.rowMarker}>{marker === 'default' ? '默认值' : '未报告'}</Text>
      ) : null}
      <Switch
        accessibilityLabel={label}
        value={checked}
        onValueChange={onToggle}
        disabled={disabled}
        trackColor={{ false: theme.color.bg.subtle, true: theme.color.bg.selected }}
        thumbColor={checked ? theme.color.text.inverse : theme.color.text.secondary}
      />
    </View>
  )
}

function ActionRow({
  label,
  disabled,
  grouped,
  onPress
}: {
  label: string
  disabled: boolean
  grouped: boolean
  onPress: () => void
}): React.JSX.Element {
  const styles = useMobileThemeStyles(createStyles)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={[styles.row, grouped && styles.rowGrouped, disabled && styles.rowDisabled]}
      onPress={onPress}
      disabled={disabled}
    >
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
    </Pressable>
  )
}

export function SessionOptionSummaryRow({
  label,
  value,
  disabled,
  divided,
  onPress
}: {
  label: string
  value: string
  disabled: boolean
  divided: boolean
  onPress: () => void
}): React.JSX.Element {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  return (
    <Pressable
      accessibilityLabel={`${label}，${value}`}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.summaryRow,
        divided && styles.rowDivided,
        pressed && !disabled && styles.pressed,
        disabled && styles.rowDisabled
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue} numberOfLines={1}>
        {value}
      </Text>
      <ChevronRight size={16} color={theme.color.text.tertiary} strokeWidth={2} />
    </Pressable>
  )
}

export function DescriptorRows({
  descriptor,
  disabled,
  grouped = false,
  onSetOption,
  onInvokeAction
}: {
  descriptor: SessionOptionDescriptor
  disabled: boolean
  grouped?: boolean
  onSetOption: (value: SessionOptionValue) => void
  onInvokeAction: () => void
}): React.JSX.Element {
  const locked = disabled || !descriptor.settable
  // Why: flip-only without a baseline is an action — never claim On/Off.
  if (descriptor.action?.type === 'toggle-command') {
    return (
      <ActionRow
        label={`切换${descriptor.label}`}
        disabled={locked}
        grouped={grouped}
        onPress={onInvokeAction}
      />
    )
  }
  // Why: agent-picker opens the TUI; it is not a set of radio choices.
  if (descriptor.action?.type === 'agent-picker') {
    return (
      <ActionRow
        label="在 Agent 选择器中选择…"
        disabled={locked}
        grouped={grouped}
        onPress={onInvokeAction}
      />
    )
  }
  // One switch, not an On/Off pair: the option is binary. The value always
  // renders; the marker is what keeps an unpicked one from reading as confirmed,
  // since the switch itself cannot say "nobody said".
  if (descriptor.kind.type === 'boolean') {
    return (
      <ToggleRow
        label={descriptor.label}
        checked={descriptor.kind.currentValue}
        marker={sessionOptionValueMarker(descriptor)}
        disabled={locked}
        grouped={grouped}
        onToggle={(next) => onSetOption(next)}
      />
    )
  }
  const { currentValue, choices } = descriptor.kind
  return (
    <>
      {choices.map((choice, index) => (
        <ChoiceRow
          key={choice.value}
          label={choice.label}
          description={choice.description}
          selected={choice.value === currentValue}
          disabled={locked}
          grouped={grouped}
          divided={grouped && index < choices.length - 1}
          onPress={() => onSetOption(choice.value)}
        />
      ))}
    </>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4,
      maxWidth: 180,
      minHeight: theme.size.minimumTouchTarget,
      paddingHorizontal: theme.spacing.space8,
      paddingVertical: theme.spacing.space4,
      borderRadius: theme.radii.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      backgroundColor: theme.color.bg.elevated
    },
    pillText: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      fontWeight: '600',
      flexShrink: 1
    },
    pillTextDisabled: {
      color: theme.color.text.tertiary
    },
    pressed: {
      opacity: 0.7
    },
    caption: {
      ...theme.typography.meta,
      color: theme.color.text.tertiary,
      paddingHorizontal: theme.spacing.space12,
      paddingBottom: theme.spacing.space4
    },
    rowMarker: {
      ...theme.typography.meta,
      color: theme.color.text.tertiary
    },
    row: {
      flexDirection: 'row',
      gap: theme.spacing.space8,
      padding: theme.spacing.space8,
      minHeight: theme.size.groupedListRowMinHeight,
      alignItems: 'center',
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.elevated,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      marginBottom: theme.spacing.space4
    },
    rowSelected: {
      borderColor: theme.color.brand.primary
    },
    rowGrouped: {
      marginBottom: 0,
      borderWidth: 0,
      borderRadius: 0,
      backgroundColor: 'transparent'
    },
    rowDivided: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border.subtle
    },
    rowDisabled: {
      opacity: 0.5
    },
    radio: {
      width: theme.spacing.space20,
      height: theme.spacing.space20,
      borderRadius: theme.radii.circle,
      borderWidth: 1.5,
      borderColor: theme.color.text.tertiary,
      alignItems: 'center',
      justifyContent: 'center'
    },
    radioOn: {
      backgroundColor: theme.color.brand.primary,
      borderColor: theme.color.brand.primary
    },
    rowBody: {
      flex: 1,
      gap: theme.spacing.space4
    },
    rowLabel: {
      ...theme.typography.label,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    rowDescription: {
      ...theme.typography.meta,
      color: theme.color.text.secondary
    },
    summaryRow: {
      minHeight: theme.size.groupedListRowMinHeight,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space8
    },
    summaryLabel: {
      ...theme.typography.label,
      flex: 1,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    summaryValue: {
      ...theme.typography.label,
      maxWidth: 160,
      color: theme.color.text.secondary
    }
  })
}
