import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import { BellRing, MessageSquare } from 'lucide-react-native'
import type { MobileOnboardingStep } from './mobile-onboarding-plan'
import { createMobileOnboardingStyles } from './mobile-onboarding-styles'
import type { MobileSessionView } from '../storage/session-view-preferences'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'

export type NotificationOnboardingChoice = 'enable' | 'skip'
export type MobileOnboardingBusyChoice = MobileSessionView | NotificationOnboardingChoice | null

type Props = {
  step: MobileOnboardingStep
  width: number
  active: boolean
  busyChoice: MobileOnboardingBusyChoice
  error: string | null
  onSessionChoice: (view: MobileSessionView) => void
  onNotificationChoice: (choice: NotificationOnboardingChoice) => void
}

export function MobileOnboardingPage({
  step,
  width,
  active,
  busyChoice,
  error,
  onSessionChoice,
  onNotificationChoice
}: Props) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createMobileOnboardingStyles)
  const busy = busyChoice !== null
  const isSessionView = step === 'session-view'

  return (
    <ScrollView
      style={[styles.page, { width }]}
      contentContainerStyle={styles.pageContent}
      showsVerticalScrollIndicator={false}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
    >
      <View style={styles.content}>
        <View style={styles.iconSurface}>
          {isSessionView ? (
            <MessageSquare
              size={theme.spacing.space24}
              strokeWidth={2}
              color={theme.color.text.primary}
            />
          ) : (
            <BellRing
              size={theme.spacing.space24}
              strokeWidth={2}
              color={theme.color.text.primary}
            />
          )}
        </View>
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={styles.title}>
          {isSessionView ? '选择会话打开方式' : '及时获取任务动态'}
        </Text>
        <Text maxFontSizeMultiplier={1.3} style={styles.body}>
          {isSessionView
            ? '选择此设备上的 Agent 会话默认在终端或聊天界面中打开。长按会话标签页可随时切换，也可稍后在设置中修改。'
            : '当 Agent 需要你处理或完成任务时，在此设备上接收通知。'}
        </Text>
      </View>

      <View style={styles.footer}>
        {error ? (
          <Text accessibilityRole="alert" maxFontSizeMultiplier={1.3} style={styles.error}>
            {error}
          </Text>
        ) : null}
        {isSessionView ? (
          <SessionViewChoices busyChoice={busyChoice} disabled={busy} onChoice={onSessionChoice} />
        ) : (
          <NotificationChoices
            busyChoice={busyChoice}
            disabled={busy}
            onChoice={onNotificationChoice}
          />
        )}
      </View>
    </ScrollView>
  )
}

function SessionViewChoices({
  busyChoice,
  disabled,
  onChoice
}: {
  busyChoice: MobileOnboardingBusyChoice
  disabled: boolean
  onChoice: (view: MobileSessionView) => void
}) {
  return (
    <>
      <ChoiceButton
        label="使用聊天界面"
        accessibilityLabel="默认使用聊天界面打开会话"
        primary
        busy={busyChoice === 'chat'}
        disabled={disabled}
        onPress={() => onChoice('chat')}
      />
      <ChoiceButton
        label="保留终端"
        accessibilityLabel="默认使用终端打开会话"
        busy={busyChoice === 'terminal'}
        disabled={disabled}
        onPress={() => onChoice('terminal')}
      />
    </>
  )
}

function NotificationChoices({
  busyChoice,
  disabled,
  onChoice
}: {
  busyChoice: MobileOnboardingBusyChoice
  disabled: boolean
  onChoice: (choice: NotificationOnboardingChoice) => void
}) {
  return (
    <>
      <ChoiceButton
        label="开启通知"
        accessibilityLabel="开启 Agent 通知"
        primary
        busy={busyChoice === 'enable'}
        disabled={disabled}
        onPress={() => onChoice('enable')}
      />
      <ChoiceButton
        label="暂不开启"
        accessibilityLabel="暂不开启 Agent 通知"
        busy={busyChoice === 'skip'}
        disabled={disabled}
        onPress={() => onChoice('skip')}
      />
    </>
  )
}

function ChoiceButton({
  label,
  accessibilityLabel,
  primary = false,
  busy,
  disabled,
  onPress
}: {
  label: string
  accessibilityLabel?: string
  primary?: boolean
  busy: boolean
  disabled: boolean
  onPress: () => void
}) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createMobileOnboardingStyles)

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy, disabled }}
      disabled={disabled}
      style={({ pressed }) => [
        styles.choiceButton,
        primary ? styles.primaryButton : styles.secondaryButton,
        pressed && styles.buttonPressed,
        disabled && styles.buttonDisabled
      ]}
      onPress={onPress}
    >
      {busy ? (
        <ActivityIndicator
          color={primary ? theme.color.text.inverse : theme.color.text.secondary}
          size="small"
        />
      ) : (
        <Text
          maxFontSizeMultiplier={1.3}
          style={primary ? styles.primaryButtonText : styles.secondaryButtonText}
        >
          {label}
        </Text>
      )}
    </Pressable>
  )
}
