import { Platform, StyleSheet, Text, TextInput, View } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { compactMobileBrowserFileAddress } from './browser-url'

type Props = {
  disabled: boolean
  focused: boolean
  onBlur: () => void
  onChangeText: (value: string) => void
  onFocus: () => void
  onSubmit: () => void
  value: string
}

export function MobileBrowserAddressField({
  disabled,
  focused,
  onBlur,
  onChangeText,
  onFocus,
  onSubmit,
  value
}: Props): React.JSX.Element {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const fileLabel = focused ? null : compactMobileBrowserFileAddress(value)
  const selection = focused ? undefined : { start: 0, end: 0 }

  return (
    <View style={styles.field}>
      <TextInput
        style={[styles.input, focused && styles.inputFocused, disabled && styles.disabled]}
        value={value}
        onChangeText={onChangeText}
        onFocus={onFocus}
        onBlur={onBlur}
        onSubmitEditing={onSubmit}
        selectTextOnFocus
        selection={selection}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={Platform.OS === 'ios' ? 'url' : 'default'}
        numberOfLines={1}
        returnKeyType="go"
        placeholder="URL"
        placeholderTextColor={theme.color.text.tertiary}
        selectionColor={theme.color.brand.primary}
        accessibilityLabel="Browser address"
        accessibilityState={{ disabled }}
        maxFontSizeMultiplier={1.3}
        editable={!disabled}
      />
      {fileLabel ? (
        <View pointerEvents="none" style={styles.fileLabelHost}>
          <Text style={styles.fileLabel} numberOfLines={1} ellipsizeMode="middle">
            {fileLabel}
          </Text>
        </View>
      ) : null}
    </View>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    field: {
      flex: 1,
      minWidth: 0,
      minHeight: theme.size.minimumTouchTarget
    },
    input: {
      ...theme.typography.code,
      flex: 1,
      minWidth: 0,
      minHeight: theme.size.minimumTouchTarget,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface,
      color: theme.color.text.primary,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: 0,
      includeFontPadding: false,
      textAlignVertical: 'center'
    },
    inputFocused: {
      borderColor: theme.color.brand.primary
    },
    fileLabelHost: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface
    },
    fileLabel: {
      ...theme.typography.code,
      color: theme.color.text.primary
    },
    disabled: {
      opacity: 0.45
    }
  })
}
