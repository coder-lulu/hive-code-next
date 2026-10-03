import { AgentStateDot } from '@/components/AgentStateDot'
import { AgentIcon } from '@/lib/agent-catalog'
import { cn } from '@/lib/utils'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { FilledBellIcon } from '../sidebar/WorktreeCardHelpers'
import { ShellIcon } from './shell-icons'
import {
  terminalTabActivityToAgentDotState,
  type TerminalTabActivityStatus
} from './terminal-tab-activity-status'
import { translate } from '@/i18n/i18n'

type TerminalTabLeadingIconProps = {
  agent: TuiAgent | null
  shell: TerminalTab['shellOverride']
  isActive: boolean
}

type TerminalTabAgentIdentityIconProps = {
  agent: TuiAgent
  isActive: boolean
  className?: string
}

/** Keep the provider glyph treatment identical across every terminal-tab state. */
function TerminalTabAgentIdentityIcon({
  agent,
  isActive,
  className
}: TerminalTabAgentIdentityIconProps): React.JSX.Element {
  return (
    <span
      className={cn('inline-flex', !isActive && 'opacity-70', className)}
      data-agent-icon={agent}
      aria-hidden
    >
      <AgentIcon agent={agent} size={16} />
    </span>
  )
}

export function TerminalTabActivityIndicator({
  activityStatus,
  showUnreadActivity
}: {
  activityStatus: TerminalTabActivityStatus
  showUnreadActivity: boolean
}): React.JSX.Element | null {
  if (showUnreadActivity) {
    return (
      <span
        data-testid="tab-activity-bell"
        aria-label={translate(
          'auto.components.tab.bar.TerminalTabLeadingIcon.7ab2964bea',
          'Unread agent completion'
        )}
        className="inline-flex shrink-0 items-center"
      >
        <FilledBellIcon className="size-3 text-amber-500" />
      </span>
    )
  }

  // Why: shared mapper with Cmd+J recent badges — working/permission/done only; active/inactive
  // fall through to agent/shell identity.
  const dotState = terminalTabActivityToAgentDotState(activityStatus)
  if (dotState) {
    return (
      <span
        data-testid="tab-agent-activity-indicator"
        data-agent-activity-status={activityStatus}
        className="inline-flex shrink-0 items-center"
      >
        <AgentStateDot state={dotState} size="md" />
      </span>
    )
  }

  return null
}

/** Keep agent or shell identity visible independently of the trailing activity state. */
export function TerminalTabLeadingIcon({
  agent,
  shell,
  isActive
}: TerminalTabLeadingIconProps): React.JSX.Element {
  if (agent) {
    return (
      <TerminalTabAgentIdentityIcon agent={agent} isActive={isActive} className="mr-1 shrink-0" />
    )
  }

  // Why: ShellIcon renders a colored brand-style tile for PowerShell, CMD,
  // Git Bash, and WSL while retaining the generic terminal fallback elsewhere.
  return (
    <span
      className={`mr-1 inline-flex shrink-0 ${isActive ? '' : 'opacity-70'}`}
      data-shell-icon={shell ?? 'generic'}
      aria-hidden
    >
      <ShellIcon shell={shell} size={16} />
    </span>
  )
}
