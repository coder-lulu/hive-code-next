import { useMemo, type RefObject } from 'react'
import { ArrowUp, Bot, Check, Code2, ImagePlus, Mic, Sparkles } from 'lucide-react-native'
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from 'react-native'
import { MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH } from '../../../src/shared/terminal-quick-commands'
import { BottomDrawer } from '../components/BottomDrawer'
import { productNameText } from '../product-brand'
import type { MobileNewTabAgentOption } from '../session/mobile-new-tab-agent-options'
import type { MobileTheme } from '../theme/mobile-theme'
import { ComposerIconButton, ComposerPicker } from './mobile-cloud-work-preview-controls'
import { createMobileCloudWorkPreviewStyles } from './mobile-cloud-work-preview-styles'
import { GRAPHITE_MASCOT } from './mobile-home-assets'

type MobileCloudWorkPreviewViewProps = {
  readonly agentOptions: readonly MobileNewTabAgentOption[]
  readonly agentPickerVisible: boolean
  readonly canPickAgent: boolean
  readonly canSubmit: boolean
  readonly composerFootnote: string
  readonly draft: string
  readonly focused: boolean
  readonly inputRef: RefObject<TextInput | null>
  readonly notice: string | null
  readonly onAgentPickerClose: () => void
  readonly onAgentPickerOpen: () => void
  readonly onDraftChange: (value: string) => void
  readonly onInputBlur: () => void
  readonly onInputFocus: () => void
  readonly onSelectAgent: (agent: MobileNewTabAgentOption['agent']) => void
  readonly onSubmit: () => Promise<void>
  readonly selectedAgent: MobileNewTabAgentOption['agent'] | null
  readonly submitting: boolean
  readonly theme: MobileTheme
}

export function MobileCloudWorkPreviewView(props: MobileCloudWorkPreviewViewProps) {
  const { width } = useWindowDimensions()
  const compact = width < props.theme.size.compactLayoutBreakpoint
  const styles = useMemo(
    () => createMobileCloudWorkPreviewStyles(props.theme, compact),
    [compact, props.theme]
  )
  const selectedAgentOption = props.agentOptions.find(
    (option) => option.agent === props.selectedAgent
  )

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.screen}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.hero, compact && styles.heroCompact]}>
          <View
            accessibilityLabel={productNameText('HiveCode 小蜜蜂助手操作笔记本电脑')}
            style={styles.assistantVisual}
          >
            <Image source={GRAPHITE_MASCOT} resizeMode="contain" style={styles.mascot} />
          </View>
          <View style={[styles.heroCopy, compact && styles.heroCopyCompact]}>
            <Text maxFontSizeMultiplier={1.3} style={styles.title}>
              今天想完成什么？
            </Text>
            <Text maxFontSizeMultiplier={1.3} style={styles.subtitle}>
              在你的 Runtime 上规划、编码并验证
            </Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.composerArea}>
        {props.notice ? (
          <View accessibilityLiveRegion="polite" style={styles.notice}>
            <Sparkles color={props.theme.color.brand.primary} size={16} strokeWidth={1.9} />
            <Text maxFontSizeMultiplier={1.3} style={styles.noticeText}>
              {props.notice}
            </Text>
          </View>
        ) : null}
        <View style={[styles.composer, props.focused && styles.composerFocused]}>
          <View style={styles.composerToolbar}>
            <ComposerIconButton
              accessibilityLabel="添加图片"
              accessibilityHint="首页任务暂不支持图片输入"
              disabled
              Icon={ImagePlus}
              styles={styles}
              theme={props.theme}
            />
            <ComposerIconButton
              accessibilityLabel="语音输入"
              accessibilityHint="首页任务暂不支持语音输入"
              disabled
              Icon={Mic}
              styles={styles}
              theme={props.theme}
            />
            <View style={styles.toolbarSpacer} />
            <ComposerPicker
              disabled={!props.canPickAgent}
              label={selectedAgentOption?.label ?? '智能体'}
              Icon={Bot}
              onPress={props.onAgentPickerOpen}
              showLabel={!compact}
              styles={styles}
              theme={props.theme}
            />
            <ComposerPicker
              disabled
              label="代码"
              Icon={Code2}
              showLabel={!compact}
              styles={styles}
              theme={props.theme}
            />
          </View>
          <View style={styles.inputRow}>
            <TextInput
              ref={props.inputRef}
              accessibilityLabel="云端工作任务"
              editable={!props.submitting}
              maxLength={MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH}
              maxFontSizeMultiplier={1.3}
              multiline
              onBlur={props.onInputBlur}
              onChangeText={props.onDraftChange}
              onFocus={props.onInputFocus}
              placeholder="描述要在 Runtime 上完成的任务"
              placeholderTextColor={props.theme.color.text.tertiary}
              selectionColor={props.theme.color.brand.primary}
              style={styles.input}
              value={props.draft}
            />
            <Pressable
              accessibilityLabel="发送任务"
              accessibilityRole="button"
              accessibilityState={{ busy: props.submitting, disabled: !props.canSubmit }}
              disabled={!props.canSubmit}
              onPress={() => void props.onSubmit()}
              style={({ pressed }) => [
                styles.sendButton,
                !props.canSubmit && styles.sendButtonDisabled,
                pressed && styles.sendButtonPressed
              ]}
            >
              {props.submitting ? (
                <ActivityIndicator color={props.theme.color.text.inverse} size="small" />
              ) : (
                <ArrowUp
                  color={
                    props.canSubmit
                      ? props.theme.color.text.inverse
                      : props.theme.color.text.tertiary
                  }
                  size={22}
                  strokeWidth={2.1}
                />
              )}
            </Pressable>
          </View>
        </View>
        <Text maxFontSizeMultiplier={1.3} style={styles.disclaimer}>
          {props.composerFootnote}
        </Text>
      </View>
      <BottomDrawer visible={props.agentPickerVisible} onClose={props.onAgentPickerClose}>
        <Text maxFontSizeMultiplier={1.3} style={styles.agentPickerTitle}>
          选择智能体
        </Text>
        <View style={styles.agentPickerGroup}>
          {props.agentOptions.map((option, index) => {
            const selected = option.agent === props.selectedAgent
            return (
              <View key={option.agent}>
                {index > 0 ? <View style={styles.agentPickerSeparator} /> : null}
                <Pressable
                  accessibilityLabel={option.label}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => props.onSelectAgent(option.agent)}
                  style={({ pressed }) => [
                    styles.agentPickerRow,
                    selected && styles.agentPickerRowSelected,
                    pressed && styles.pressed
                  ]}
                >
                  <Bot color={props.theme.color.text.primary} size={20} strokeWidth={1.9} />
                  <Text maxFontSizeMultiplier={1.3} style={styles.agentPickerLabel}>
                    {option.label}
                  </Text>
                  {selected ? (
                    <Check color={props.theme.color.brand.primary} size={18} strokeWidth={2.1} />
                  ) : null}
                </Pressable>
              </View>
            )
          })}
        </View>
      </BottomDrawer>
    </KeyboardAvoidingView>
  )
}
