import { ChevronDown, ChevronRight } from 'lucide-react-native'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { RuntimeWorktreeAgentRow } from '../../../src/shared/runtime-types'
import type { MobileTheme } from '../theme/mobile-theme'
import { agentDotState } from '../worktree/agent-row-display'
import { AgentStateDot } from './AgentStateDot'
import { MobileAgentIcon } from './MobileAgentIcon'

const MAX_VISIBLE_AGENTS = 3

type Props = {
  agents: RuntimeWorktreeAgentRow[]
  expanded: boolean
  now: number
  theme: MobileTheme
  onToggle: () => void
}

export function WorktreeAgentSummary({ agents, expanded, now, theme, onToggle }: Props) {
  const styles = createStyles(theme)
  const visibleAgents = agents.slice(0, MAX_VISIBLE_AGENTS)
  const hiddenCount = agents.length - visibleAgents.length
  const subject = `${agents.length} 个智能体`

  return (
    <Pressable
      style={({ pressed }) => [
        styles.summary,
        !expanded && styles.summaryCollapsed,
        pressed && styles.summaryPressed
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${expanded ? '收起' : '展开'} ${subject}`}
      accessibilityState={{ expanded }}
      onPress={(event) => {
        event.stopPropagation()
        onToggle()
      }}
    >
      {expanded ? (
        <Text style={styles.expandedLabel}>{subject}</Text>
      ) : (
        <View style={styles.agentIcons}>
          {visibleAgents.map((agent) => (
            <View key={agent.paneKey} style={styles.agentStatus}>
              <AgentStateDot state={agentDotState(agent, now)} />
              {agent.agentType ? <MobileAgentIcon agentId={agent.agentType} size={13} /> : null}
            </View>
          ))}
          {hiddenCount > 0 ? <Text style={styles.hiddenCount}>+{hiddenCount}</Text> : null}
        </View>
      )}
      {expanded ? (
        <ChevronDown size={12} color={theme.color.text.secondary} />
      ) : (
        <ChevronRight size={12} color={theme.color.text.secondary} />
      )}
    </Pressable>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    summary: {
      minHeight: theme.spacing.space24,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4,
      paddingHorizontal: theme.spacing.space4,
      borderRadius: theme.radii.control
    },
    summaryCollapsed: {
      borderWidth: 1,
      borderColor: theme.color.border.default,
      backgroundColor: theme.color.bg.subtle
    },
    summaryPressed: { opacity: 0.72 },
    expandedLabel: {
      ...theme.typography.caption,
      flex: 1,
      paddingLeft: theme.spacing.space4,
      fontWeight: '500',
      color: theme.color.text.secondary
    },
    agentIcons: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4
    },
    agentStatus: {
      height: theme.spacing.space20,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      paddingHorizontal: theme.spacing.space4,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface
    },
    hiddenCount: {
      ...theme.typography.caption,
      color: theme.color.text.secondary
    }
  })
}
