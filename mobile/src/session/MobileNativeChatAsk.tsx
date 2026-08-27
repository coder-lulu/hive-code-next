import { useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { Check } from 'lucide-react-native'
import type { AskAnswerSelection, AskPrompt } from '../../../src/shared/native-chat-ask'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'

type Props = {
  prompt: AskPrompt
  /** Deliver the chosen answer (per-question option indices + free text) —
   *  index-based so Claude's arrow-navigate selector can be driven by the
   *  option's stable number instead of pasted label text (STA-1860). */
  onAnswer: (selections: AskAnswerSelection[]) => Promise<boolean>
  onCancel?: () => Promise<boolean>
}

// Sentinel index for the free-text "Other…" row (never a real option index).
const OTHER = -1

/** Native renderer for an agent's AskUserQuestion prompt as a wizard: one
 *  question per step with tabs across the top, a Next button that advances (Send
 *  on the last step), and a Cancel that dismisses the prompt. Neutral styling
 *  with a subtle green accent on the active choice to match the rest of the app. */
export function MobileNativeChatAsk({ prompt, onAnswer, onCancel }: Props): React.JSX.Element {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const [index, setIndex] = useState(0)
  const [selections, setSelections] = useState<number[][]>(() => prompt.questions.map(() => []))
  const [otherText, setOtherText] = useState<string[]>(() => prompt.questions.map(() => ''))
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)

  const toggle = (qi: number, optIndex: number, multi: boolean): void => {
    setSelections((prev) => {
      const next = prev.map((s) => [...s])
      const cur = next[qi] ?? []
      if (multi) {
        next[qi] = cur.includes(optIndex) ? cur.filter((i) => i !== optIndex) : [...cur, optIndex]
      } else {
        next[qi] = cur.includes(optIndex) ? [] : [optIndex]
      }
      return next
    })
  }

  const setOther = (qi: number, value: string): void => {
    setOtherText((prev) => {
      const next = [...prev]
      next[qi] = value
      return next
    })
  }

  const selectionFor = (qi: number): AskAnswerSelection => {
    const picked = (selections[qi] ?? []).filter((i) => i !== OTHER)
    const other = (selections[qi] ?? []).includes(OTHER) ? (otherText[qi] ?? '').trim() : ''
    return other ? { indices: picked, other } : { indices: picked }
  }

  const isAnswered = (qi: number): boolean => {
    const sel = selectionFor(qi)
    return sel.indices.length > 0 || (sel.other ?? '').length > 0
  }

  const total = prompt.questions.length
  const isLast = index === total - 1
  const currentAnswered = useMemo(
    () => isAnswered(index),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selections, otherText, index]
  )
  const allAnswered = useMemo(
    () => prompt.questions.every((_, i) => isAnswered(i)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [otherText, prompt.questions, selections]
  )
  const canAdvance = !submitting && (isLast ? allAnswered : currentAnswered)

  const submit = async (): Promise<void> => {
    if (!allAnswered || submittingRef.current) {
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    try {
      await onAnswer(prompt.questions.map((_, i) => selectionFor(i)))
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const advance = async (): Promise<void> => {
    if (isLast) {
      await submit()
    } else {
      setIndex((i) => Math.min(i + 1, total - 1))
    }
  }

  const q = prompt.questions[index]!
  const otherSelected = (selections[index] ?? []).includes(OTHER)

  return (
    <View style={styles.card}>
      {total > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabs}
          contentContainerStyle={styles.tabsContent}
          keyboardShouldPersistTaps="always"
        >
          {prompt.questions.map((qq, i) => (
            <Pressable
              key={i}
              style={[styles.tab, i === index && styles.tabActive]}
              onPress={() => setIndex(i)}
            >
              <Text style={[styles.tabText, i === index && styles.tabTextActive]} numberOfLines={1}>
                {qq.header || `第 ${i + 1} 步`}
              </Text>
              {isAnswered(i) ? (
                <Check size={16} color={theme.color.brand.primary} strokeWidth={2.4} />
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="always">
        <Text style={styles.questionText}>{q.question}</Text>
        {q.options.map((opt, optIndex) => (
          <OptionRow
            key={`${optIndex}:${opt.label}`}
            label={opt.label}
            description={opt.description}
            selected={(selections[index] ?? []).includes(optIndex)}
            multi={q.multiSelect}
            onPress={() => toggle(index, optIndex, q.multiSelect)}
          />
        ))}
        <OptionRow
          label="其他…"
          selected={otherSelected}
          multi={q.multiSelect}
          onPress={() => toggle(index, OTHER, q.multiSelect)}
        />
        {otherSelected ? (
          <TextInput
            style={styles.input}
            value={otherText[index]}
            onChangeText={(v) => setOther(index, v)}
            placeholder="输入你的回答"
            placeholderTextColor={theme.color.text.tertiary}
            multiline
            autoFocus
          />
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={styles.cancel}
          onPress={async () => {
            if (!submittingRef.current && onCancel) {
              submittingRef.current = true
              setSubmitting(true)
              try {
                await onCancel()
              } finally {
                submittingRef.current = false
                setSubmitting(false)
              }
            }
          }}
          disabled={submitting}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="取消回答"
        >
          <Text style={styles.cancelText}>取消</Text>
        </Pressable>
        {total > 1 ? (
          <Text style={styles.progress}>
            {index + 1}/{total}
          </Text>
        ) : null}
        <Pressable
          style={[styles.next, !canAdvance && styles.nextDisabled]}
          onPress={advance}
          disabled={!canAdvance}
          accessibilityRole="button"
          accessibilityLabel={isLast ? '提交回答' : '下一步'}
        >
          <Text style={[styles.nextText, !canAdvance && styles.nextTextDisabled]}>
            {isLast ? '提交' : '下一步'}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

function OptionRow({
  label,
  description,
  selected,
  multi,
  onPress
}: {
  label: string
  description?: string
  selected: boolean
  multi?: boolean
  onPress: () => void
}): React.JSX.Element {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  return (
    <Pressable
      style={({ pressed }) => [
        styles.option,
        selected && styles.optionSelected,
        pressed && styles.pressed
      ]}
      onPress={onPress}
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: selected }}
    >
      {/* Multi-select reads as a checkbox (square); single-select as a radio (circle). */}
      <View
        style={[
          styles.check,
          multi ? styles.checkSquare : styles.checkCircle,
          selected && styles.checkOn
        ]}
      >
        {selected ? <Check size={12} color={theme.color.text.inverse} strokeWidth={3} /> : null}
      </View>
      <View style={styles.optionBody}>
        <Text style={styles.optionLabel}>{label}</Text>
        {description ? (
          <Text style={styles.optionDescription} numberOfLines={3}>
            {description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    card: {
      maxHeight: 380,
      backgroundColor: theme.color.bg.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.color.border.subtle
    },
    tabs: {
      flexGrow: 0,
      paddingTop: theme.spacing.space8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border.subtle
    },
    tabsContent: {
      paddingHorizontal: theme.spacing.space8,
      gap: theme.spacing.space4,
      alignItems: 'center'
    },
    tab: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4,
      minHeight: theme.size.minimumTouchTarget,
      paddingHorizontal: theme.spacing.space8,
      paddingVertical: theme.spacing.space4,
      borderBottomWidth: 2,
      borderBottomColor: 'transparent'
    },
    tabActive: {
      borderBottomColor: theme.color.brand.primary
    },
    tabText: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      fontWeight: '600'
    },
    tabTextActive: {
      color: theme.color.text.primary
    },
    scroll: {
      paddingHorizontal: theme.spacing.space12
    },
    questionText: {
      ...theme.typography.sectionTitle,
      color: theme.color.text.primary,
      fontWeight: '600',
      marginVertical: theme.spacing.space8
    },
    option: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      padding: theme.spacing.space8,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.elevated,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      marginBottom: theme.spacing.space4
    },
    optionSelected: {
      borderColor: theme.color.brand.primary
    },
    pressed: {
      opacity: 0.72
    },
    check: {
      width: theme.spacing.space20,
      height: theme.spacing.space20,
      borderWidth: 1.5,
      borderColor: theme.color.text.tertiary,
      alignItems: 'center',
      justifyContent: 'center'
    },
    checkCircle: {
      borderRadius: theme.radii.circle
    },
    checkSquare: {
      borderRadius: theme.radii.small
    },
    checkOn: {
      backgroundColor: theme.color.brand.primary,
      borderColor: theme.color.brand.primary
    },
    optionBody: {
      flex: 1,
      gap: theme.spacing.space4
    },
    optionLabel: {
      ...theme.typography.label,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    optionDescription: {
      ...theme.typography.meta,
      color: theme.color.text.secondary
    },
    input: {
      ...theme.typography.body,
      backgroundColor: theme.color.bg.elevated,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      color: theme.color.text.primary,
      padding: theme.spacing.space12,
      minHeight: theme.size.minimumTouchTarget,
      marginBottom: theme.spacing.space4
    },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: theme.spacing.space12,
      gap: theme.spacing.space8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.color.border.subtle
    },
    cancel: {
      minHeight: theme.size.minimumTouchTarget,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space8
    },
    cancelText: {
      ...theme.typography.label,
      color: theme.color.text.secondary,
      fontWeight: '600'
    },
    progress: {
      ...theme.typography.meta,
      color: theme.color.text.tertiary
    },
    next: {
      minHeight: theme.size.minimumTouchTarget,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space16,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.selected
    },
    nextDisabled: {
      backgroundColor: theme.color.bg.subtle
    },
    nextText: {
      ...theme.typography.label,
      color: theme.color.text.inverse,
      fontWeight: '600'
    },
    nextTextDisabled: {
      color: theme.color.text.tertiary
    }
  })
}
