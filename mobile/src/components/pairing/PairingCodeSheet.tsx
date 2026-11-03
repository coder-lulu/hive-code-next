import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { hostOs } from '../../platform/host-os'
import { useState } from 'react'
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { productNameText } from '../../product-brand'
import type { MobileTheme } from '../../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../../theme/mobile-theme-provider'
import { PairingActionButton } from './PairingActionButton'

export function PairingCodeSheet(props: {
  onCancel: () => void
  onSubmit: (value: string) => void
  visible: boolean
}) {
  const t = useMobileTranslation()

  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const [value, setValue] = useState('')
  const [previousVisible, setPreviousVisible] = useState(props.visible)

  if (props.visible !== previousVisible) {
    setPreviousVisible(props.visible)
    if (props.visible) {
      setValue('')
    }
  }

  const trimmedValue = value.trim()
  const submit = () => {
    if (trimmedValue) {
      props.onSubmit(trimmedValue)
    }
  }

  return (
    <Modal
      animationType="slide"
      onRequestClose={props.onCancel}
      transparent
      visible={props.visible}
    >
      <KeyboardAvoidingView
        behavior={hostOs() === 'ios' ? 'padding' : undefined}
        style={styles.modal}
      >
        <Pressable
          accessibilityLabel={t(
            'auto.mobile.src.components.pairing.PairingCodeSheet.038830a905',
            'Close pairing code entry'
          )}
          accessibilityRole="button"
          onPress={props.onCancel}
          style={styles.backdrop}
        />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.handle} />
          <Text accessibilityRole="header" style={styles.title}>
            {t(
              'auto.mobile.src.components.pairing.PairingCodeSheet.6b9900af4a',
              'Enter pairing code'
            )}
          </Text>
          <Text style={styles.message}>
            {productNameText('复制电脑版 Orca 二维码下方的配对码。')}
          </Text>
          <TextInput
            accessibilityLabel={t(
              'auto.mobile.src.components.pairing.PairingCodeSheet.9f41911b98',
              'Pairing code'
            )}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            onChangeText={setValue}
            onSubmitEditing={submit}
            placeholder={t(
              'auto.mobile.src.components.pairing.PairingCodeSheet.fb813efeb6',
              'hivecode://pair?code=… or pairing code'
            )}
            placeholderTextColor={theme.color.text.tertiary}
            returnKeyType="done"
            selectionColor={theme.color.brand.primary}
            style={styles.input}
            value={value}
          />
          <View style={styles.actions}>
            <PairingActionButton
              label={t('common.cancel', 'Cancel')}
              onPress={props.onCancel}
              variant="secondary"
            />
            <PairingActionButton
              disabled={!trimmedValue}
              label={t(
                'auto.mobile.src.components.pairing.PairingCodeSheet.3636547c38',
                'Verify and connect'
              )}
              onPress={submit}
            />
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    modal: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.color.overlay },
    sheet: {
      borderTopLeftRadius: theme.radii.overlay,
      borderTopRightRadius: theme.radii.overlay,
      backgroundColor: theme.color.bg.elevated,
      paddingHorizontal: theme.spacing.space20,
      paddingTop: theme.spacing.space8,
      paddingBottom: theme.spacing.space16
    },
    handle: {
      width: 40,
      height: 4,
      alignSelf: 'center',
      borderRadius: theme.radii.small,
      backgroundColor: theme.color.border.default,
      marginBottom: theme.spacing.space20
    },
    title: { ...theme.typography.pageTitle, color: theme.color.text.primary },
    message: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      marginTop: theme.spacing.space4,
      marginBottom: theme.spacing.space16
    },
    input: {
      minHeight: 48,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle,
      color: theme.color.text.primary,
      paddingHorizontal: theme.spacing.space16,
      ...theme.typography.body
    },
    actions: { gap: theme.spacing.space8, marginTop: theme.spacing.space16 }
  })
}
