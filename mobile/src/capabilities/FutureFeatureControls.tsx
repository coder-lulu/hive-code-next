import { type ReactNode, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type TextInputProps
} from 'react-native'
import {
  MobileSegmentedControl,
  type MobileSegmentedControlOption
} from '../components/ui/MobileSegmentedControl'
import { useFutureFeatureTheme } from './future-feature-theme'

export function FutureFeatureSegmentedControl<T extends string>(props: {
  readonly label: string
  readonly onValueChange: (value: T) => void
  readonly options: readonly [MobileSegmentedControlOption<T>, MobileSegmentedControlOption<T>]
  readonly value: T
}) {
  const theme = useFutureFeatureTheme()
  return (
    <View style={{ gap: theme.spacing.space8 }}>
      <Text
        maxFontSizeMultiplier={1.3}
        style={[theme.typography.meta, { color: theme.color.text.secondary }]}
      >
        {props.label}
      </Text>
      <MobileSegmentedControl
        accessibilityLabel={props.label}
        onValueChange={props.onValueChange}
        options={props.options}
        value={props.value}
      />
    </View>
  )
}

export interface FutureFeatureInputProps extends Pick<
  TextInputProps,
  | 'value'
  | 'onChangeText'
  | 'placeholder'
  | 'multiline'
  | 'maxLength'
  | 'secureTextEntry'
  | 'autoComplete'
> {
  readonly label: string
  readonly keyboardType?: KeyboardTypeOptions
}

export function FutureFeatureInput({ label, ...inputProps }: FutureFeatureInputProps) {
  const theme = useFutureFeatureTheme()
  const [focused, setFocused] = useState(false)
  return (
    <View style={{ gap: theme.spacing.space8 }}>
      <Text
        maxFontSizeMultiplier={1.3}
        style={[theme.typography.label, { color: theme.color.text.primary }]}
      >
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        maxFontSizeMultiplier={1.3}
        onBlur={() => setFocused(false)}
        onFocus={() => setFocused(true)}
        placeholderTextColor={theme.color.text.tertiary}
        selectionColor={theme.color.brand.primary}
        style={[
          styles.input,
          inputProps.multiline && styles.multilineInput,
          theme.typography.body,
          {
            minHeight: inputProps.multiline
              ? theme.spacing.space64 + theme.spacing.space48
              : theme.spacing.space48,
            color: theme.color.text.primary,
            borderColor: focused ? theme.color.brand.primary : theme.color.border.default,
            borderRadius: theme.radii.control,
            backgroundColor: theme.color.bg.surface,
            paddingHorizontal: theme.spacing.space12,
            paddingVertical: theme.spacing.space12
          }
        ]}
        {...inputProps}
      />
    </View>
  )
}

export interface FutureFeatureActionProps {
  readonly label: string
  readonly disabled: boolean
  readonly reason?: string | null
  readonly destructive?: boolean
  readonly loading?: boolean
  readonly onPress?: () => void | Promise<void>
}

export function FutureFeatureAction({
  label,
  disabled,
  reason,
  destructive = false,
  loading = false,
  onPress
}: FutureFeatureActionProps) {
  const theme = useFutureFeatureTheme()
  const [focused, setFocused] = useState(false)
  const unavailable = disabled || loading
  const backgroundColor = unavailable
    ? theme.color.bg.subtle
    : destructive
      ? theme.color.bg.surface
      : theme.color.bg.selected
  const textColor = unavailable
    ? theme.color.text.tertiary
    : destructive
      ? theme.color.status.dangerText
      : theme.color.text.inverse
  const borderColor = focused
    ? theme.color.brand.primary
    : destructive && !unavailable
      ? theme.color.status.danger
      : backgroundColor
  return (
    <View style={{ gap: theme.spacing.space8 }}>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{ busy: loading, disabled: unavailable }}
        disabled={unavailable}
        onBlur={() => setFocused(false)}
        onFocus={() => setFocused(true)}
        style={({ pressed }) => [
          styles.action,
          {
            minHeight: theme.spacing.space48,
            borderColor,
            borderRadius: theme.radii.control,
            backgroundColor,
            opacity: pressed ? 0.72 : 1
          }
        ]}
        onPress={onPress}
      >
        {loading ? (
          <ActivityIndicator color={textColor} size="small" />
        ) : (
          <Text maxFontSizeMultiplier={1.3} style={[theme.typography.label, { color: textColor }]}>
            {label}
          </Text>
        )}
      </Pressable>
      {reason ? (
        <Text
          accessibilityLiveRegion="polite"
          maxFontSizeMultiplier={1.3}
          style={[theme.typography.caption, { color: theme.color.text.secondary }]}
        >
          {reason}
        </Text>
      ) : null}
    </View>
  )
}

export interface FutureFeatureNoticeProps {
  readonly title: string
  readonly children: ReactNode
  readonly danger?: boolean
}

export function FutureFeatureNotice({ title, children, danger = false }: FutureFeatureNoticeProps) {
  const theme = useFutureFeatureTheme()
  return (
    <View
      accessibilityLiveRegion={danger ? 'assertive' : 'polite'}
      accessibilityRole={danger ? 'alert' : undefined}
      style={{
        padding: theme.spacing.space16,
        gap: theme.spacing.space8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: danger ? theme.color.status.danger : theme.color.border.default,
        borderRadius: theme.radii.card,
        backgroundColor: theme.color.bg.surface
      }}
    >
      <Text
        maxFontSizeMultiplier={1.3}
        style={[
          theme.typography.sectionTitle,
          { color: danger ? theme.color.status.dangerText : theme.color.text.primary }
        ]}
      >
        {title}
      </Text>
      <Text
        maxFontSizeMultiplier={1.3}
        style={[theme.typography.meta, { color: theme.color.text.secondary }]}
      >
        {children}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  input: { borderWidth: 1 },
  multilineInput: { textAlignVertical: 'top' },
  action: { borderWidth: 1, alignItems: 'center', justifyContent: 'center' }
})
