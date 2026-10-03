import { View, Text, Pressable, StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { BottomDrawer } from './BottomDrawer'

type ContentProps = {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

type Props = ContentProps & { visible: boolean }

export function ConfirmModal({ visible, ...content }: Props) {
  return (
    <BottomDrawer visible={visible} onClose={content.onCancel}>
      <ConfirmContent {...content} />
    </BottomDrawer>
  )
}

export function ConfirmContent({
  title,
  message,
  confirmLabel = '确认',
  cancelLabel = '取消',
  destructive = false,
  onConfirm,
  onCancel
}: ContentProps) {
  const styles = useMobileThemeStyles(createStyles)
  return (
    <>
      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        {message ? <Text style={styles.message}>{message}</Text> : null}
      </View>
      <View style={styles.buttons}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={cancelLabel}
          style={({ pressed }) => [styles.button, styles.cancelButton, pressed && styles.pressed]}
          onPress={onCancel}
        >
          <Text style={styles.cancelText}>{cancelLabel}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={confirmLabel}
          style={({ pressed }) => [
            styles.button,
            destructive ? styles.destructiveButton : styles.confirmButton,
            pressed && styles.pressed
          ]}
          onPress={() => {
            onConfirm()
            onCancel()
          }}
        >
          <Text style={destructive ? styles.destructiveText : styles.confirmText}>
            {confirmLabel}
          </Text>
        </Pressable>
      </View>
    </>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    content: {
      paddingBottom: theme.spacing.space16
    },
    title: {
      ...theme.typography.sectionTitle,
      color: theme.color.text.primary
    },
    message: {
      ...theme.typography.body,
      marginTop: theme.spacing.space4,
      color: theme.color.text.secondary
    },
    buttons: {
      flexDirection: 'row',
      gap: theme.spacing.space8
    },
    button: {
      minHeight: theme.size.minimumTouchTarget,
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space12
    },
    cancelButton: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      backgroundColor: theme.color.bg.surface
    },
    confirmButton: {
      backgroundColor: theme.color.bg.selected
    },
    destructiveButton: {
      backgroundColor: theme.color.status.danger
    },
    pressed: {
      opacity: 0.72
    },
    cancelText: {
      ...theme.typography.label,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    confirmText: {
      ...theme.typography.label,
      color: theme.color.text.inverse,
      fontWeight: '600'
    },
    destructiveText: {
      ...theme.typography.label,
      color: '#FFFFFF',
      fontWeight: '600'
    }
  })
}
