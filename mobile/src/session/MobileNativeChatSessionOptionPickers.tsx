import { useState } from 'react'
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, View } from 'react-native'
import { ChevronLeft, X } from 'lucide-react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import {
  sessionOptionDispatchUnconfirmed,
  type SessionOptionDescriptor,
  type SessionOptionValue
} from '../../../src/shared/native-chat-session-options'
import {
  mobileModelPillLabel,
  mobileOptionsPillLabel,
  mobileSessionOptionSummaryValue,
  mobileSessionOptionDisabledReason
} from './mobile-native-chat-session-option-labels'
import {
  DescriptorRows,
  Pill,
  SessionOptionCaption,
  SessionOptionSummaryRow
} from './MobileNativeChatSessionOptionRows'
import { sortNativeChatSessionOptions } from '../../../src/shared/native-chat-session-option-snapshot'
import type { MobileNativeChatSessionOptionsController } from './use-mobile-native-chat-session-options'

export type MobileNativeChatSessionOptionPickersProps = {
  controller: MobileNativeChatSessionOptionsController
  /** Pickers lock while the agent works — a mid-turn `/model` interleaves with
   *  the agent's own output (desktop parity). */
  isWorking: boolean
  /** A composer send owns the TUI input line until it settles. The host spaces a
   *  send's body and its Enter ~500ms apart, so an apply dispatched inside that
   *  window would be submitted as part of the user's prompt. The composer blocks
   *  the reverse direction on `pendingId`; this is the same guard mirrored. */
  sendInFlight?: boolean
}

function localizeOptionValue(value: string): string {
  const labels: Record<string, string> = {
    Model: '模型',
    Options: '选项',
    'Not set': '未设置',
    On: '开启',
    Off: '关闭',
    Fast: '快速'
  }
  return labels[value] ?? value
}

function localizeDisabledReason(reason: string | null): string | null {
  if (reason === 'Set when the session starts.') {
    return '请在会话开始时设置。'
  }
  if (reason === 'Available after the session starts.') {
    return '会话开始后可用。'
  }
  return reason
}

/** Combined model/session-option trigger and its mobile bottom drawer. */
export function MobileNativeChatSessionOptionPickers({
  controller,
  isWorking,
  sendInFlight = false
}: MobileNativeChatSessionOptionPickersProps): React.JSX.Element | null {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const [openDescriptorId, setOpenDescriptorId] = useState<string | null>(null)
  const [lastRequest, setLastRequest] = useState(controller.optionPickerRequest)
  if (controller.optionPickerRequest && lastRequest !== controller.optionPickerRequest) {
    setLastRequest(controller.optionPickerRequest)
    setOpenDescriptorId(controller.optionPickerRequest.id)
  }
  const { snapshot, pendingId } = controller
  const model = snapshot.find((descriptor) => descriptor.category === 'model')
  const options = sortNativeChatSessionOptions(snapshot)
  if (!model) {
    return null
  }
  const disabled = isWorking || pendingId !== null || sendInFlight
  const activeDescriptor = snapshot.find((descriptor) => descriptor.id === openDescriptorId)
  const modelView = activeDescriptor?.id === model.id
  const modelLabel = localizeOptionValue(mobileModelPillLabel(model))
  const optionsLabel =
    options.length > 0 ? localizeOptionValue(mobileOptionsPillLabel(options)) : null
  const pillLabel = optionsLabel ? `${modelLabel} ${optionsLabel}` : modelLabel
  const reason = localizeDisabledReason(
    mobileSessionOptionDisabledReason(activeDescriptor?.disabledReason)
  )

  const closePicker = (): void => setOpenDescriptorId(null)
  const openPicker = (): void => {
    Keyboard.dismiss()
    setOpenDescriptorId(model.id)
  }

  const applyOption = (descriptor: SessionOptionDescriptor, value: SessionOptionValue): void => {
    // Re-picking the tracked value is a no-op — never re-dispatch it.
    if (
      descriptor.valueSource !== 'unknown' &&
      descriptor.kind.type === 'select' &&
      descriptor.kind.currentValue === value
    ) {
      closePicker()
      return
    }
    void controller.setOption(descriptor.id, value).then((applied) => {
      if (applied) {
        closePicker()
      }
    })
  }
  const invokeAction = (descriptor: SessionOptionDescriptor): void => {
    void controller.invokeAction(descriptor.id).then((invoked) => {
      if (invoked) {
        closePicker()
      }
    })
  }

  return (
    <View>
      <Pill
        label={pillLabel}
        accessibleName={`模型，${pillLabel}`}
        disabled={disabled}
        onPress={openPicker}
      />
      <BottomDrawer visible={activeDescriptor !== undefined} onClose={closePicker}>
        {activeDescriptor ? (
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Pressable
                accessibilityLabel={modelView ? '关闭选择器' : '返回模型列表'}
                accessibilityRole="button"
                style={({ pressed }) => [styles.sheetNav, pressed && styles.pressed]}
                onPress={modelView ? closePicker : () => setOpenDescriptorId(model.id)}
                hitSlop={8}
              >
                {modelView ? (
                  <X size={20} color={theme.color.text.secondary} strokeWidth={2} />
                ) : (
                  <ChevronLeft size={20} color={theme.color.text.secondary} strokeWidth={2} />
                )}
              </Pressable>
              <Text style={styles.sheetTitle}>
                {modelView ? '选择模型' : `选择${activeDescriptor.label}`}
              </Text>
              <View style={styles.sheetHeaderSide}>
                {pendingId !== null ? (
                  <ActivityIndicator size="small" color={theme.color.text.secondary} />
                ) : null}
              </View>
            </View>
            {sessionOptionDispatchUnconfirmed(activeDescriptor) ? (
              <SessionOptionCaption>已发送给 Agent，尚未确认</SessionOptionCaption>
            ) : null}
            {reason ? <SessionOptionCaption>{reason}</SessionOptionCaption> : null}
            <View style={styles.choiceGroup}>
              <DescriptorRows
                descriptor={activeDescriptor}
                disabled={disabled}
                grouped
                onSetOption={(value) => applyOption(activeDescriptor, value)}
                onInvokeAction={() => invokeAction(activeDescriptor)}
              />
            </View>
            {modelView && options.length > 0 ? (
              <View style={styles.optionGroup}>
                {options.map((descriptor, index) => (
                  <SessionOptionSummaryRow
                    key={descriptor.id}
                    label={descriptor.label}
                    value={localizeOptionValue(mobileSessionOptionSummaryValue(descriptor))}
                    disabled={disabled}
                    divided={index < options.length - 1}
                    onPress={() => setOpenDescriptorId(descriptor.id)}
                  />
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </BottomDrawer>
    </View>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    sheet: {
      paddingBottom: theme.spacing.space4
    },
    sheetHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingBottom: theme.spacing.space16
    },
    sheetTitle: {
      ...theme.typography.pageTitle,
      flex: 1,
      color: theme.color.text.primary,
      fontWeight: '600',
      textAlign: 'center'
    },
    sheetNav: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      borderRadius: theme.radii.circle,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.color.bg.elevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default
    },
    sheetHeaderSide: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center'
    },
    choiceGroup: {
      overflow: 'hidden',
      borderRadius: theme.radii.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      backgroundColor: theme.color.bg.elevated
    },
    optionGroup: {
      overflow: 'hidden',
      marginTop: theme.spacing.space12,
      borderRadius: theme.radii.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      backgroundColor: theme.color.bg.elevated
    },
    pressed: {
      opacity: 0.7
    }
  })
}
