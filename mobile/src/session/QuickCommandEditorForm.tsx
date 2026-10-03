import { useState } from 'react'
import { View, Text, Pressable, TextInput, StyleSheet, Switch } from 'react-native'
import { ChevronDown, ChevronRight } from 'lucide-react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { TEXT_INPUT_FONT_SIZE } from '../platform/text-input-font-size'
import { MobileAgentIcon } from '../components/MobileAgentIcon'
import {
  getQuickCommandAgentLabel,
  MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH,
  MAX_QUICK_COMMAND_LABEL_LENGTH,
  MAX_QUICK_COMMAND_TERMINAL_TEXT_LENGTH
} from '../terminal/quick-commands'
import type { QuickCommandDraft } from './quick-command-draft'
import { isQuickCommandDraftValid } from './quick-command-draft'

type Props = {
  draft: QuickCommandDraft
  mode: 'add' | 'edit'
  saving: boolean
  error: string | null
  // A mobile session lives in one repo, so "Project" scope means the current
  // worktree's repo — no cross-repo picker like desktop.
  repoId: string | null
  repoName: string | null
  onChange: (patch: Partial<QuickCommandDraft>) => void
  onOpenAgentPicker: () => void
  onCancel: () => void
  onSave: () => void
}

function ActionToggle({
  value,
  onChange
}: {
  value: QuickCommandDraft['action']
  onChange: (action: QuickCommandDraft['action']) => void
}) {
  const styles = useMobileThemeStyles(createStyles)
  return (
    <View style={styles.toggleGroup}>
      {(['terminal-command', 'agent-prompt'] as const).map((action) => {
        const selected = value === action
        return (
          <Pressable
            key={action}
            style={({ pressed }) => [
              styles.toggleItem,
              selected && styles.toggleItemSelected,
              pressed && !selected && styles.pressed
            ]}
            onPress={() => onChange(action)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
          >
            <Text style={[styles.toggleText, selected && styles.toggleTextSelected]}>
              {action === 'terminal-command' ? '终端命令' : 'Agent 提示词'}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

export function QuickCommandEditorForm({
  draft,
  mode,
  saving,
  error,
  repoId,
  repoName,
  onChange,
  onOpenAgentPicker,
  onCancel,
  onSave
}: Props) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const hasRepoScope = repoId !== null
  const [advancedOpen, setAdvancedOpen] = useState(draft.scope.type === 'repo')
  const isAgent = draft.action === 'agent-prompt'
  const canSave = isQuickCommandDraftValid(draft) && !saving

  return (
    <View style={styles.form}>
      <View style={styles.field}>
        <Text style={styles.label}>名称</Text>
        <TextInput
          style={styles.input}
          value={draft.label}
          onChangeText={(label) => onChange({ label })}
          placeholder="启动开发服务器"
          placeholderTextColor={theme.color.text.tertiary}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={MAX_QUICK_COMMAND_LABEL_LENGTH}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>操作</Text>
        <ActionToggle value={draft.action} onChange={(action) => onChange({ action })} />
      </View>

      {isAgent ? (
        <View style={styles.field}>
          <Text style={styles.label}>Agent</Text>
          <Pressable
            style={({ pressed }) => [styles.select, pressed && styles.pressed]}
            onPress={onOpenAgentPicker}
            accessibilityRole="button"
          >
            {draft.agent ? (
              <View style={styles.selectValue}>
                <MobileAgentIcon agentId={draft.agent} size={16} />
                <Text style={styles.selectValueText}>{getQuickCommandAgentLabel(draft.agent)}</Text>
              </View>
            ) : (
              <Text style={styles.selectPlaceholder}>选择 Agent</Text>
            )}
            <ChevronDown size={16} color={theme.color.text.tertiary} />
          </Pressable>
        </View>
      ) : null}

      <View style={styles.field}>
        <Text style={styles.label}>{isAgent ? '提示词' : '命令内容'}</Text>
        <TextInput
          style={[styles.input, styles.textarea, !isAgent && styles.mono]}
          value={isAgent ? draft.prompt : draft.command}
          onChangeText={(text) => onChange(isAgent ? { prompt: text } : { command: text })}
          placeholder={isAgent ? '让 Agent 检查此工作区' : 'npm run dev'}
          placeholderTextColor={theme.color.text.tertiary}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          maxLength={
            isAgent ? MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH : MAX_QUICK_COMMAND_TERMINAL_TEXT_LENGTH
          }
        />
        {isAgent ? <Text style={styles.hint}>支持 Skills、文件路径和内置命令。</Text> : null}
      </View>

      <View style={styles.field}>
        <Pressable
          style={({ pressed }) => [styles.advancedToggle, pressed && styles.pressed]}
          onPress={() => setAdvancedOpen((open) => !open)}
          accessibilityRole="button"
          accessibilityState={{ expanded: advancedOpen }}
        >
          {advancedOpen ? (
            <ChevronDown size={16} color={theme.color.text.secondary} />
          ) : (
            <ChevronRight size={16} color={theme.color.text.secondary} />
          )}
          <Text style={styles.advancedText}>高级选项</Text>
        </Pressable>

        {advancedOpen ? (
          <View style={styles.advancedBody}>
            {!isAgent ? (
              <View style={styles.switchRow}>
                <View style={styles.switchText}>
                  <Text style={styles.switchTitle}>自动回车</Text>
                  <Text style={styles.switchDesc}>立即提交，而不是仅插入文本。</Text>
                </View>
                <Switch
                  value={draft.appendEnter}
                  onValueChange={(appendEnter) => onChange({ appendEnter })}
                  trackColor={{
                    false: theme.color.bg.subtle,
                    true: theme.color.brand.primary
                  }}
                  thumbColor={theme.color.bg.surface}
                />
              </View>
            ) : null}

            <View style={styles.field}>
              <Text style={styles.label}>作用域</Text>
              <View style={styles.toggleGroup}>
                {(['global', 'repo'] as const).map((scopeType) => {
                  const selected = draft.scope.type === scopeType
                  const disabled = scopeType === 'repo' && !hasRepoScope
                  return (
                    <Pressable
                      key={scopeType}
                      disabled={disabled}
                      style={({ pressed }) => [
                        styles.toggleItem,
                        selected && styles.toggleItemSelected,
                        disabled && styles.toggleItemDisabled,
                        pressed && !selected && !disabled && styles.pressed
                      ]}
                      onPress={() =>
                        onChange({
                          scope:
                            scopeType === 'repo' && repoId
                              ? { type: 'repo', repoId }
                              : { type: 'global' }
                        })
                      }
                      accessibilityRole="button"
                      accessibilityState={{ selected, disabled }}
                    >
                      <Text style={[styles.toggleText, selected && styles.toggleTextSelected]}>
                        {scopeType === 'global' ? '全局' : '当前项目'}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
              {draft.scope.type === 'repo' && repoName ? (
                <Text style={styles.scopeRepoName}>{repoName}</Text>
              ) : null}
            </View>
          </View>
        ) : null}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [styles.button, styles.cancelButton, pressed && styles.pressed]}
          onPress={onCancel}
          accessibilityRole="button"
        >
          <Text style={styles.cancelText}>取消</Text>
        </Pressable>
        <Pressable
          style={[styles.button, styles.saveButton, !canSave && styles.saveButtonDisabled]}
          disabled={!canSave}
          onPress={onSave}
          accessibilityRole="button"
        >
          <Text style={[styles.saveText, !canSave && styles.saveTextDisabled]}>
            {mode === 'edit' ? '保存' : '添加快捷命令'}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    form: {
      gap: theme.spacing.space12,
      paddingTop: theme.spacing.space4,
      paddingBottom: theme.spacing.space8
    },
    field: { gap: theme.spacing.space8 },
    label: { ...theme.typography.caption, fontWeight: '600', color: theme.color.text.secondary },
    input: {
      ...theme.typography.label,
      fontSize: TEXT_INPUT_FONT_SIZE,
      minHeight: theme.size.minimumTouchTarget,
      backgroundColor: theme.color.bg.surface,
      color: theme.color.text.primary,
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space8,
      borderWidth: 1,
      borderColor: theme.color.border.default
    },
    textarea: { minHeight: 92, textAlignVertical: 'top' },
    mono: { ...theme.typography.code, fontSize: TEXT_INPUT_FONT_SIZE },
    hint: { ...theme.typography.caption, color: theme.color.text.tertiary },
    error: {
      ...theme.typography.meta,
      color: theme.color.status.dangerText,
      marginTop: theme.spacing.space4
    },
    pressed: { backgroundColor: theme.color.bg.subtle },
    toggleGroup: { flexDirection: 'row', gap: theme.spacing.space8 },
    toggleItem: {
      flex: 1,
      minHeight: theme.size.minimumTouchTarget,
      borderRadius: theme.radii.control,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      backgroundColor: theme.color.bg.surface,
      alignItems: 'center',
      justifyContent: 'center'
    },
    toggleItemSelected: {
      backgroundColor: theme.color.bg.selected,
      borderColor: theme.color.bg.selected
    },
    toggleItemDisabled: { opacity: 0.4 },
    toggleText: { ...theme.typography.meta, fontWeight: '500', color: theme.color.text.secondary },
    toggleTextSelected: { color: theme.color.text.inverse },
    select: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: theme.color.bg.surface,
      borderRadius: theme.radii.control,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space8
    },
    selectValue: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.space8 },
    selectValueText: { ...theme.typography.label, color: theme.color.text.primary },
    selectPlaceholder: { ...theme.typography.label, color: theme.color.text.tertiary },
    scopeRepoName: {
      ...theme.typography.code,
      color: theme.color.text.secondary,
      paddingHorizontal: theme.spacing.space4
    },
    advancedToggle: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4,
      paddingVertical: theme.spacing.space4
    },
    advancedText: {
      ...theme.typography.meta,
      fontWeight: '600',
      color: theme.color.text.secondary
    },
    advancedBody: { gap: theme.spacing.space12, paddingTop: theme.spacing.space4 },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.space12 },
    switchText: { flex: 1 },
    switchTitle: { ...theme.typography.label, color: theme.color.text.primary },
    switchDesc: {
      ...theme.typography.caption,
      color: theme.color.text.tertiary,
      marginTop: theme.spacing.space4
    },
    footer: {
      flexDirection: 'row',
      gap: theme.spacing.space8,
      marginTop: theme.spacing.space8
    },
    button: {
      flex: 1,
      minHeight: theme.size.minimumTouchTarget,
      borderRadius: theme.radii.control,
      paddingVertical: theme.spacing.space12,
      alignItems: 'center',
      justifyContent: 'center'
    },
    cancelButton: { borderWidth: 1, borderColor: theme.color.border.default },
    cancelText: { ...theme.typography.label, fontWeight: '600', color: theme.color.text.primary },
    saveButton: { backgroundColor: theme.color.bg.selected },
    saveButtonDisabled: { backgroundColor: theme.color.bg.subtle },
    saveText: { ...theme.typography.label, fontWeight: '600', color: theme.color.text.inverse },
    saveTextDisabled: { color: theme.color.text.tertiary }
  })
}
