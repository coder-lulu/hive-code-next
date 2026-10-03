import { useRef, type ReactNode } from 'react'
import {
  ActivityIndicator,
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Edit3, Trash2, type LucideIcon } from 'lucide-react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { BottomDrawer } from './BottomDrawer'

export type ActionSheetAction = {
  label: string
  icon?: LucideIcon
  renderIcon?: () => ReactNode
  destructive?: boolean
  disabled?: boolean
  hint?: string
  loading?: boolean
  skipAutoClose?: boolean
  closeBeforePress?: boolean
  onPress: () => void
}

type Props = {
  visible: boolean
  title?: string
  message?: string
  actions: ActionSheetAction[]
  fixedHeight?: boolean
  onClose: () => void
}

function iconForAction(label: string, destructive?: boolean, icon?: LucideIcon): LucideIcon {
  if (icon) {
    return icon
  }
  if (destructive || /delete|remove/i.test(label)) {
    return Trash2
  }
  return Edit3
}

type ContentProps = {
  title?: string
  message?: string
  actions: ActionSheetAction[]
  onClose?: () => void
  scrollActions?: boolean
}

export function ActionSheetContent({
  title,
  message,
  actions,
  onClose,
  scrollActions = false
}: ContentProps) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const actionGroup = (
    <View style={styles.actionGroup}>
      {actions.map((action, i) => {
        const Icon = iconForAction(action.label, action.destructive, action.icon)
        const customIcon = action.renderIcon?.()
        return (
          <View key={action.label}>
            {i > 0 && <View style={styles.separator} />}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={action.label}
              accessibilityState={{
                disabled: Boolean(action.disabled || action.loading),
                busy: Boolean(action.loading)
              }}
              style={({ pressed }) => [
                styles.action,
                action.disabled && styles.actionDisabled,
                pressed && !action.disabled && !action.loading && styles.actionPressed
              ]}
              disabled={action.disabled || action.loading}
              onPress={() => {
                action.onPress()
                if (!action.skipAutoClose && onClose) {
                  onClose()
                }
              }}
            >
              {customIcon ?? (
                <Icon
                  size={20}
                  color={
                    action.destructive ? theme.color.status.danger : theme.color.text.secondary
                  }
                />
              )}
              <View style={styles.actionTextBlock}>
                <Text
                  maxFontSizeMultiplier={1.3}
                  style={[
                    styles.actionText,
                    action.destructive && styles.actionTextDestructive,
                    action.disabled && styles.actionTextDisabled
                  ]}
                >
                  {action.label}
                </Text>
                {action.hint ? (
                  <Text maxFontSizeMultiplier={1.3} style={styles.actionHint}>
                    {action.hint}
                  </Text>
                ) : null}
              </View>
              {action.loading ? (
                <ActivityIndicator size="small" color={theme.color.text.secondary} />
              ) : null}
            </Pressable>
          </View>
        )
      })}
    </View>
  )
  return (
    <>
      {(title || message) && (
        <View style={styles.header}>
          {title ? (
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
          ) : null}
          {message ? <Text style={styles.message}>{message}</Text> : null}
        </View>
      )}

      {scrollActions ? (
        <ScrollView
          style={styles.actionScroll}
          showsVerticalScrollIndicator
          persistentScrollbar
          keyboardShouldPersistTaps="handled"
        >
          {actionGroup}
        </ScrollView>
      ) : (
        actionGroup
      )}
    </>
  )
}

export function ActionSheetModal({
  visible,
  title,
  message,
  actions,
  onClose,
  fixedHeight = false
}: Props) {
  const { height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const theme = useMobileTheme()
  const contentHeight = Math.max(
    0,
    Math.min(
      height * theme.size.actionSheetHeightRatio,
      height - insets.top - insets.bottom - theme.spacing.space64
    )
  )
  const pendingActionRef = useRef<(() => void) | null>(null)
  const sequencedActions = actions.map((action) =>
    action.closeBeforePress
      ? {
          ...action,
          onPress: () => {
            pendingActionRef.current = action.onPress
          }
        }
      : action
  )

  return (
    <BottomDrawer
      visible={visible}
      onClose={onClose}
      onAfterClose={() => {
        // Why: iOS cannot present a second native modal until the action
        // sheet's native window has fully unmounted.
        const pendingAction = pendingActionRef.current
        pendingActionRef.current = null
        pendingAction?.()
      }}
      dragContentToDismiss={!fixedHeight}
      contentScrollable={!fixedHeight}
    >
      <View style={fixedHeight ? { height: contentHeight } : undefined}>
        <ActionSheetContent
          title={title}
          message={message}
          actions={sequencedActions}
          scrollActions={fixedHeight}
          onClose={onClose}
        />
      </View>
    </BottomDrawer>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    header: {
      paddingHorizontal: theme.spacing.space4,
      paddingBottom: theme.spacing.space12
    },
    title: {
      ...theme.typography.label,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    message: {
      ...theme.typography.caption,
      color: theme.color.text.secondary,
      marginTop: theme.spacing.space4
    },
    actionScroll: {
      flex: 1,
      minHeight: 0
    },
    actionGroup: {
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.subtle,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      marginHorizontal: theme.spacing.space16,
      backgroundColor: theme.color.border.subtle
    },
    action: {
      minHeight: theme.size.groupedListRowMinHeight,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space12,
      paddingVertical: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space16
    },
    actionDisabled: {
      opacity: 0.58
    },
    actionPressed: {
      backgroundColor: theme.color.bg.subtle
    },
    actionTextBlock: {
      flex: 1,
      minWidth: 0
    },
    actionText: {
      ...theme.typography.body,
      color: theme.color.text.primary,
      fontWeight: '500'
    },
    actionTextDisabled: {
      color: theme.color.text.secondary
    },
    actionTextDestructive: {
      color: theme.color.status.dangerText
    },
    actionHint: {
      ...theme.typography.caption,
      marginTop: theme.spacing.space4,
      color: theme.color.text.tertiary
    }
  })
}
