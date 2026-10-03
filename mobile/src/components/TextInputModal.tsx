import { useState } from 'react'
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions
} from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { TEXT_INPUT_FONT_SIZE } from '../platform/text-input-font-size'
import { BottomDrawer } from './BottomDrawer'

type Props = {
  visible: boolean
  title: string
  message?: string
  errorMessage?: string
  submitting?: boolean
  defaultValue?: string
  placeholder?: string
  submitLabel?: string
  selectTextOnFocus?: boolean
  allowEmpty?: boolean
  keyboardType?: KeyboardTypeOptions
  onSubmit: (value: string) => void
  onCancel: () => void
  /** Called once the drawer has gone, which is when the field stops holding the focus. */
  onAfterClose?: () => void
}

export function TextInputModal({
  visible,
  title,
  message,
  errorMessage,
  submitting = false,
  defaultValue = '',
  placeholder,
  submitLabel = 'Save',
  selectTextOnFocus = false,
  allowEmpty = false,
  keyboardType,
  onSubmit,
  onCancel,
  onAfterClose
}: Props) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const [value, setValue] = useState(defaultValue)
  const [focused, setFocused] = useState(false)
  const [previousVisible, setPreviousVisible] = useState(visible)
  const [previousDefaultValue, setPreviousDefaultValue] = useState(defaultValue)

  // Why: reset before the opening commit so the drawer never paints the
  // previous modal value while preserving the existing close animation state.
  const shouldResetValue = visible && (!previousVisible || defaultValue !== previousDefaultValue)
  if (visible !== previousVisible || shouldResetValue) {
    setPreviousVisible(visible)
    if (shouldResetValue) {
      setPreviousDefaultValue(defaultValue)
      setValue(defaultValue)
    }
  }

  function handleSubmit() {
    const trimmed = value.trim()
    if (!submitting && (trimmed || allowEmpty)) {
      onSubmit(trimmed)
    }
  }

  const canSubmit = !submitting && (allowEmpty || value.trim().length > 0)

  return (
    <BottomDrawer visible={visible} onClose={onCancel} onAfterClose={onAfterClose}>
      <View style={styles.header}>
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={styles.title}>
          {title}
        </Text>
        {message ? (
          <Text maxFontSizeMultiplier={1.3} style={styles.message}>
            {message}
          </Text>
        ) : null}
      </View>

      <TextInput
        accessibilityLabel={title}
        style={[styles.input, focused && styles.inputFocused]}
        value={value}
        onChangeText={setValue}
        placeholder={placeholder}
        placeholderTextColor={theme.color.text.tertiary}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        selectTextOnFocus={selectTextOnFocus}
        keyboardType={keyboardType}
        returnKeyType="done"
        onSubmitEditing={handleSubmit}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        selectionColor={theme.color.brand.primary}
        maxFontSizeMultiplier={1.3}
      />

      {errorMessage ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          maxFontSizeMultiplier={1.3}
          style={styles.error}
        >
          {errorMessage}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Pressable
          accessibilityLabel="Cancel"
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.button,
            styles.cancelButton,
            pressed && styles.buttonPressed
          ]}
          onPress={onCancel}
        >
          <Text maxFontSizeMultiplier={1.3} style={styles.cancelText}>
            Cancel
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel={submitLabel}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSubmit, busy: submitting }}
          style={({ pressed }) => [
            styles.button,
            styles.submitButton,
            pressed && styles.buttonPressed,
            !canSubmit && styles.submitButtonDisabled
          ]}
          disabled={!canSubmit}
          onPress={handleSubmit}
        >
          <Text maxFontSizeMultiplier={1.3} style={styles.submitText}>
            {submitLabel}
          </Text>
        </Pressable>
      </View>
    </BottomDrawer>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    header: { paddingBottom: theme.spacing.space12 },
    title: {
      ...theme.typography.sectionTitle,
      color: theme.color.text.primary
    },
    message: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      marginTop: theme.spacing.space4
    },
    error: {
      ...theme.typography.meta,
      color: theme.color.status.danger,
      marginTop: theme.spacing.space8
    },
    input: {
      minHeight: theme.spacing.space48,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space12,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface,
      color: theme.color.text.primary,
      ...theme.typography.body,
      fontSize: TEXT_INPUT_FONT_SIZE
    },
    inputFocused: {
      borderColor: theme.color.brand.primary,
      borderWidth: 1
    },
    actions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: theme.spacing.space8,
      marginTop: theme.spacing.space12
    },
    button: {
      minHeight: theme.size.minimumTouchTarget,
      minWidth: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space12,
      borderRadius: theme.radii.control
    },
    cancelButton: {
      borderWidth: 1,
      borderColor: theme.color.border.default,
      backgroundColor: theme.color.bg.surface
    },
    submitButton: { backgroundColor: theme.color.bg.selected },
    buttonPressed: { opacity: 0.72 },
    submitButtonDisabled: { opacity: 0.4 },
    cancelText: {
      ...theme.typography.label,
      color: theme.color.text.primary
    },
    submitText: {
      ...theme.typography.label,
      color: theme.color.text.inverse,
      fontWeight: '600'
    }
  })
}
