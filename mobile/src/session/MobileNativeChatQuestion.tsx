import { useMemo, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { ArrowUp, Check, CircleHelp, X } from 'lucide-react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { TEXT_INPUT_FONT_SIZE } from '../platform/text-input-font-size'
import {
  formatQuestionAnswerByIndexes,
  formatQuestionAnswerWithOtherByIndexes,
  formatQuestionFreeTextAnswer,
  type MobileChatQuestion
} from './mobile-native-chat-question'

type Props = {
  question: MobileChatQuestion
  onAnswer: (text: string) => Promise<boolean>
  onCancel?: (prompt?: NonNullable<MobileChatQuestion['prompt']>) => Promise<boolean>
}

/** Structured prompts restrict free text when required; heuristic prompts retain an escape hatch. */
export function MobileNativeChatQuestion({
  question,
  onAnswer,
  onCancel
}: Props): React.JSX.Element {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const [selectedOptionIndexes, setSelectedOptionIndexes] = useState<number[]>([])
  const [freeText, setFreeText] = useState('')
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)
  const allowOther = question.allowOther !== false

  const hasOptions = question.options.length > 0
  const trimmedFreeText = freeText.trim()

  const toggle = (optionIndex: number): void => {
    setSelectedOptionIndexes((prev) =>
      prev.includes(optionIndex)
        ? prev.filter((index) => index !== optionIndex)
        : [...prev, optionIndex]
    )
  }

  const sendAnswer = async (text: string): Promise<boolean> => {
    if (sendingRef.current) {
      return false
    }
    sendingRef.current = true
    setSending(true)
    try {
      return await onAnswer(text)
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  const answerSingle = async (optionIndex: number): Promise<void> => {
    const token = question.optionTokens[optionIndex]
    await sendAnswer(
      token && token.length > 0 ? token : formatQuestionAnswerByIndexes(question, [optionIndex])
    )
  }

  const submitMulti = async (): Promise<void> => {
    if (selectedOptionIndexes.length === 0) {
      return
    }
    const answer =
      question.freeTextToken && trimmedFreeText.length > 0
        ? formatQuestionAnswerWithOtherByIndexes(question, selectedOptionIndexes, trimmedFreeText)
        : formatQuestionAnswerByIndexes(question, selectedOptionIndexes)
    if (await sendAnswer(answer)) {
      setFreeText('')
    }
  }

  const submitFreeText = async (): Promise<void> => {
    if (!allowOther || trimmedFreeText.length === 0) {
      return
    }
    const answer =
      question.multiSelect && question.freeTextToken && selectedOptionIndexes.length > 0
        ? formatQuestionAnswerWithOtherByIndexes(question, selectedOptionIndexes, trimmedFreeText)
        : formatQuestionFreeTextAnswer(question, trimmedFreeText)
    if (await sendAnswer(answer)) {
      setFreeText('')
    }
  }

  const canSubmitMulti = selectedOptionIndexes.length > 0 && !sending
  const canSendFreeText = allowOther && trimmedFreeText.length > 0 && !sending

  // Stable keys for option rows even if an agent repeats a label.
  const optionRows = useMemo(
    () =>
      question.options.map((label, index) => ({
        label,
        description: question.optionDescriptions?.[index],
        key: `${index}:${label}`
      })),
    [question.optionDescriptions, question.options]
  )

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <CircleHelp size={16} color={theme.color.brand.primary} strokeWidth={2} />
        <Text style={styles.question}>{question.question}</Text>
        {onCancel ? (
          <Pressable
            accessibilityLabel="取消问题"
            accessibilityRole="button"
            accessibilityState={{ disabled: sending }}
            hitSlop={8}
            style={({ pressed }) => [styles.cancel, pressed && !sending && styles.pressed]}
            onPress={() => void onCancel(question.prompt)}
            disabled={sending}
          >
            <X size={16} color={theme.color.text.tertiary} />
          </Pressable>
        ) : null}
      </View>

      {hasOptions ? (
        <View style={styles.options}>
          {optionRows.map(({ label, description, key }, optIndex) => {
            const isSelected = selectedOptionIndexes.includes(optIndex)
            return (
              <Pressable
                key={key}
                accessibilityRole={question.multiSelect ? 'checkbox' : 'button'}
                accessibilityState={question.multiSelect ? { checked: isSelected } : undefined}
                style={({ pressed }) => [
                  styles.option,
                  isSelected && styles.optionSelected,
                  pressed && styles.pressed
                ]}
                onPress={() => (question.multiSelect ? toggle(optIndex) : answerSingle(optIndex))}
              >
                {question.multiSelect ? (
                  <View style={[styles.checkbox, isSelected && styles.checkboxOn]}>
                    {isSelected ? (
                      <Check size={12} color={theme.color.text.inverse} strokeWidth={3} />
                    ) : null}
                  </View>
                ) : null}
                <View style={styles.optionBody}>
                  <Text style={styles.optionText}>{label}</Text>
                  {description ? (
                    <Text style={styles.optionDescription} numberOfLines={2}>
                      {description}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            )
          })}
        </View>
      ) : null}

      {question.multiSelect && hasOptions ? (
        <Pressable
          accessibilityLabel="提交已选选项"
          style={({ pressed }) => [
            styles.submit,
            !canSubmitMulti && styles.submitDisabled,
            pressed && canSubmitMulti && styles.pressed
          ]}
          onPress={submitMulti}
          disabled={!canSubmitMulti}
        >
          <Text style={[styles.submitText, !canSubmitMulti && styles.submitTextDisabled]}>
            提交{selectedOptionIndexes.length > 0 ? `（${selectedOptionIndexes.length}）` : ''}
          </Text>
        </Pressable>
      ) : null}

      {allowOther ? (
        <View style={styles.freeTextRow}>
          <TextInput
            style={styles.freeInput}
            value={freeText}
            onChangeText={setFreeText}
            placeholder={hasOptions ? '或输入回复…' : '输入你的回复…'}
            placeholderTextColor={theme.color.text.tertiary}
            selectionColor={theme.color.brand.primary}
            onSubmitEditing={submitFreeText}
            returnKeyType="send"
            multiline
          />
          <Pressable
            accessibilityLabel="发送回复"
            style={({ pressed }) => [
              styles.freeSend,
              !canSendFreeText && styles.freeSendDisabled,
              pressed && canSendFreeText && styles.pressed
            ]}
            onPress={submitFreeText}
            disabled={!canSendFreeText}
          >
            <ArrowUp
              size={18}
              color={canSendFreeText ? theme.color.text.inverse : theme.color.text.tertiary}
              strokeWidth={2.6}
            />
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    card: {
      marginHorizontal: theme.spacing.space16,
      marginVertical: theme.spacing.space8,
      padding: theme.spacing.space16,
      gap: theme.spacing.space8,
      backgroundColor: theme.color.bg.surface,
      borderRadius: theme.radii.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8
    },
    cancel: {
      minWidth: theme.size.minimumTouchTarget,
      minHeight: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center'
    },
    question: {
      ...theme.typography.sectionTitle,
      flex: 1,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    options: {
      gap: theme.spacing.space4
    },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      minHeight: theme.size.minimumTouchTarget,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space8,
      backgroundColor: theme.color.bg.elevated,
      borderRadius: theme.radii.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default
    },
    optionSelected: {
      borderColor: theme.color.brand.primary
    },
    optionBody: {
      flex: 1,
      gap: theme.spacing.space4
    },
    optionDescription: {
      ...theme.typography.meta,
      color: theme.color.text.secondary
    },
    optionText: {
      ...theme.typography.body,
      color: theme.color.text.primary
    },
    checkbox: {
      width: theme.spacing.space20,
      height: theme.spacing.space20,
      borderRadius: theme.radii.small,
      borderWidth: 1.5,
      borderColor: theme.color.text.tertiary,
      alignItems: 'center',
      justifyContent: 'center'
    },
    checkboxOn: {
      backgroundColor: theme.color.brand.primary,
      borderColor: theme.color.brand.primary
    },
    submit: {
      minHeight: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.selected
    },
    submitDisabled: {
      backgroundColor: theme.color.bg.subtle
    },
    submitText: {
      ...theme.typography.label,
      color: theme.color.text.inverse,
      fontWeight: '600'
    },
    submitTextDisabled: {
      color: theme.color.text.tertiary
    },
    freeTextRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: theme.spacing.space8
    },
    freeInput: {
      ...theme.typography.body,
      fontSize: TEXT_INPUT_FONT_SIZE,
      flex: 1,
      minHeight: theme.size.minimumTouchTarget,
      maxHeight: 120,
      color: theme.color.text.primary,
      backgroundColor: theme.color.bg.subtle,
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing.space12,
      paddingTop: theme.spacing.space8,
      paddingBottom: theme.spacing.space8
    },
    freeSend: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      borderRadius: theme.radii.circle,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.color.bg.selected
    },
    freeSendDisabled: {
      backgroundColor: theme.color.bg.subtle
    },
    pressed: {
      opacity: 0.7
    }
  })
}
