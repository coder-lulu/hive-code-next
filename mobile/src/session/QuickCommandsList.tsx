import { View, Text, Pressable, TextInput, StyleSheet, ActivityIndicator } from 'react-native'
import { Check, Plus, Search } from 'lucide-react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { TEXT_INPUT_FONT_SIZE } from '../platform/text-input-font-size'
import { MobileAgentIcon } from '../components/MobileAgentIcon'
import { MOBILE_AGENT_CATALOG } from '../tasks/mobile-agent-catalog'
import type { TerminalQuickCommand } from '../../../src/shared/terminal-quick-command-types'
import type { TuiAgent } from '../../../src/shared/tui-agent'
import { supportsTerminalAgentQuickCommand } from '../terminal/quick-commands'
import { QuickCommandRow } from './QuickCommandRow'

export const QUICK_COMMAND_SUPPORTED_AGENTS = MOBILE_AGENT_CATALOG.filter((entry) =>
  supportsTerminalAgentQuickCommand(entry.id)
)

export const QUICK_COMMAND_SEARCH_QUERY_MAX_LENGTH = 2048

type ListProps = {
  repoCommands: TerminalQuickCommand[]
  globalCommands: TerminalQuickCommand[]
  totalCount: number
  query: string
  loading: boolean
  disabled: boolean
  canAdd: boolean
  error: string | null
  onQueryChange: (value: string) => void
  onLaunch: (command: TerminalQuickCommand) => void
  onEdit: (command: TerminalQuickCommand) => void
  onDelete: (command: TerminalQuickCommand) => void
  onAdd: () => void
}

export function QuickCommandsList({
  repoCommands,
  globalCommands,
  totalCount,
  query,
  loading,
  disabled,
  canAdd,
  error,
  onQueryChange,
  onLaunch,
  onEdit,
  onDelete,
  onAdd
}: ListProps) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const hasVisible = repoCommands.length + globalCommands.length > 0
  const addDisabled = disabled || !canAdd
  // Why: keep an active filter clearable if a delete or paired desktop edit
  // leaves only one command while the sheet is open.
  const showSearch = totalCount > 1 || query.length > 0
  return (
    <View style={styles.listBody}>
      {showSearch ? (
        <View style={styles.search}>
          <Search size={16} color={theme.color.text.tertiary} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={onQueryChange}
            placeholder="搜索快捷命令…"
            placeholderTextColor={theme.color.text.tertiary}
            autoCapitalize="none"
            autoCorrect={false}
            // Why: bound pasted text before it reaches the per-keystroke JS
            // search path; useful queries are far smaller than this budget.
            maxLength={QUICK_COMMAND_SEARCH_QUERY_MAX_LENGTH}
          />
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loading && !hasVisible ? (
        <ActivityIndicator style={styles.loading} color={theme.color.text.secondary} />
      ) : null}

      {!loading && totalCount === 0 ? <Text style={styles.empty}>暂无快捷命令。</Text> : null}

      {!loading && totalCount > 0 && !hasVisible ? (
        <Text style={styles.empty}>没有匹配的快捷命令。</Text>
      ) : null}

      {repoCommands.length > 0 ? (
        <QuickCommandGroup
          label="当前项目"
          commands={repoCommands}
          onLaunch={onLaunch}
          onEdit={onEdit}
          onDelete={onDelete}
          disabled={disabled}
        />
      ) : null}

      {globalCommands.length > 0 ? (
        <QuickCommandGroup
          label="全局"
          commands={globalCommands}
          onLaunch={onLaunch}
          onEdit={onEdit}
          onDelete={onDelete}
          disabled={disabled}
        />
      ) : null}

      <Pressable
        style={({ pressed }) => [
          styles.addRow,
          addDisabled && styles.disabled,
          pressed && !addDisabled && styles.pressed
        ]}
        disabled={addDisabled}
        onPress={onAdd}
        accessibilityRole="button"
        accessibilityLabel={canAdd ? '新建快捷命令' : '已达到快捷命令数量上限'}
      >
        <Plus size={20} color={theme.color.text.secondary} />
        <Text style={styles.addText}>{canAdd ? '新建快捷命令' : '已达到快捷命令数量上限'}</Text>
      </Pressable>
    </View>
  )
}

function QuickCommandGroup({
  label,
  commands,
  onLaunch,
  onEdit,
  onDelete,
  disabled
}: {
  label: string
  commands: TerminalQuickCommand[]
  onLaunch: (command: TerminalQuickCommand) => void
  onEdit: (command: TerminalQuickCommand) => void
  onDelete: (command: TerminalQuickCommand) => void
  disabled: boolean
}) {
  const styles = useMobileThemeStyles(createStyles)
  return (
    <View>
      <Text style={styles.groupLabel}>{label}</Text>
      <View style={styles.group}>
        {commands.map((command, index) => (
          <QuickCommandRow
            key={command.id}
            command={command}
            first={index === 0}
            onLaunch={onLaunch}
            onEdit={onEdit}
            onDelete={onDelete}
            disabled={disabled}
          />
        ))}
      </View>
    </View>
  )
}

export function QuickCommandAgentPicker({
  selected,
  onSelect
}: {
  selected: TuiAgent | null
  onSelect: (agent: TuiAgent) => void
}) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  return (
    <View style={styles.group}>
      {QUICK_COMMAND_SUPPORTED_AGENTS.map((agent, index) => (
        <Pressable
          key={agent.id}
          style={({ pressed }) => [
            styles.row,
            index > 0 && styles.rowBorder,
            pressed && styles.pressed
          ]}
          onPress={() => onSelect(agent.id)}
          accessibilityRole="button"
          accessibilityState={{ selected: selected === agent.id }}
        >
          <View style={styles.rowIcon}>
            <MobileAgentIcon agentId={agent.id} size={16} />
          </View>
          <Text style={styles.agentLabel}>{agent.label}</Text>
          {selected === agent.id ? <Check size={16} color={theme.color.brand.primary} /> : null}
        </Pressable>
      ))}
    </View>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    pressed: { backgroundColor: theme.color.bg.subtle },
    disabled: { opacity: 0.45 },
    listBody: { gap: theme.spacing.space8, paddingBottom: theme.spacing.space8 },
    search: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      backgroundColor: theme.color.bg.surface,
      borderRadius: theme.radii.control,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space8
    },
    searchInput: {
      ...theme.typography.label,
      fontSize: TEXT_INPUT_FONT_SIZE,
      flex: 1,
      color: theme.color.text.primary,
      padding: 0
    },
    error: {
      ...theme.typography.meta,
      color: theme.color.status.dangerText,
      paddingHorizontal: theme.spacing.space4
    },
    loading: { paddingVertical: theme.spacing.space16 },
    empty: {
      ...theme.typography.label,
      color: theme.color.text.tertiary,
      textAlign: 'center',
      paddingVertical: theme.spacing.space16
    },
    groupLabel: {
      ...theme.typography.caption,
      fontWeight: '600',
      color: theme.color.text.tertiary,
      paddingHorizontal: theme.spacing.space4,
      paddingTop: theme.spacing.space4,
      paddingBottom: theme.spacing.space4
    },
    group: {
      backgroundColor: theme.color.bg.surface,
      borderRadius: theme.radii.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.subtle,
      overflow: 'hidden'
    },
    row: {
      minHeight: theme.size.groupedListRowMinHeight,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.space12,
      gap: theme.spacing.space12
    },
    rowBorder: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.color.border.subtle
    },
    rowIcon: {
      width: theme.spacing.space32,
      height: theme.spacing.space32,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle,
      alignItems: 'center',
      justifyContent: 'center'
    },
    agentLabel: { ...theme.typography.label, flex: 1, color: theme.color.text.primary },
    addRow: {
      minHeight: theme.size.groupedListRowMinHeight,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      backgroundColor: theme.color.bg.surface,
      borderRadius: theme.radii.card,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: theme.color.border.default,
      paddingVertical: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space12,
      marginTop: theme.spacing.space4
    },
    addText: { ...theme.typography.label, fontWeight: '600', color: theme.color.text.primary }
  })
}
