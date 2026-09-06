import { ChevronDown, type LucideIcon } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { Pressable, Text } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import type { MobileCloudWorkPreviewStyles } from './mobile-cloud-work-preview-styles'

export function ComposerIconButton(props: {
  readonly accessibilityLabel: string
  readonly accessibilityHint?: string
  readonly disabled?: boolean
  readonly Icon: LucideIcon
  readonly onPress?: () => void
  readonly styles: MobileCloudWorkPreviewStyles
  readonly theme: MobileTheme
}) {
  return (
    <Pressable
      accessibilityLabel={props.accessibilityLabel}
      accessibilityHint={props.accessibilityHint}
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        props.styles.composerIconButton,
        props.disabled && props.styles.composerControlDisabled,
        pressed && props.styles.pressed
      ]}
    >
      <props.Icon
        color={props.disabled ? props.theme.color.text.tertiary : props.theme.color.text.primary}
        size={20}
        strokeWidth={1.9}
      />
    </Pressable>
  )
}

export function ComposerPicker(props: {
  readonly disabled?: boolean
  readonly label: string
  readonly Icon: LucideIcon
  readonly renderIcon?: () => ReactNode
  readonly onPress?: () => void
  readonly showLabel: boolean
  readonly styles: MobileCloudWorkPreviewStyles
  readonly theme: MobileTheme
}) {
  return (
    <Pressable
      accessibilityLabel={`选择${props.label}`}
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        props.styles.composerPicker,
        props.disabled && props.styles.composerControlDisabled,
        pressed && props.styles.pressed
      ]}
    >
      {props.renderIcon ? (
        props.renderIcon()
      ) : (
        <props.Icon
          color={props.disabled ? props.theme.color.text.tertiary : props.theme.color.text.primary}
          size={20}
          strokeWidth={1.9}
        />
      )}
      {props.showLabel ? (
        <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={props.styles.composerPickerText}>
          {props.label}
        </Text>
      ) : null}
      <ChevronDown
        color={props.disabled ? props.theme.color.text.tertiary : props.theme.color.text.secondary}
        size={16}
        strokeWidth={1.9}
      />
    </Pressable>
  )
}
