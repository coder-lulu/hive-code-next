import { useDraggable } from '@dnd-kit/core'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { AgentIcon, getAgentCatalog } from '@/lib/agent-catalog'
import SessionStatus from './SessionStatus'
import type { SessionListItem } from './session-list-types'

export default function SessionPanelTab({
  item,
  groupId,
  selected,
  onActivate,
  onClose
}: {
  item: SessionListItem
  groupId?: string
  selected: boolean
  onActivate: () => void
  onClose: () => void
}): React.JSX.Element {
  const agent = getAgentCatalog().find((entry) => entry.id === item.agent)
  const drag = useDraggable({ id: `session-tab:${item.key}`, data: { sessionKey: item.key } })
  return (
    <div className="session-current-tab" data-selected={selected} ref={drag.setNodeRef}>
      {selected && <span className="tab-active-shape" aria-hidden />}
      <button
        {...drag.attributes}
        {...drag.listeners}
        type="button"
        role="tab"
        id={
          selected
            ? groupId
              ? `session-current-tab-${groupId}`
              : 'session-current-tab'
            : undefined
        }
        aria-selected={selected}
        aria-controls={groupId ? `session-content-${groupId}` : 'session-content'}
        onClick={onActivate}
      >
        <span className="session-tab-icon" title={agent?.label}>
          {agent ? (
            <AgentIcon agent={agent.id} size={16} />
          ) : (
            <SessionStatus status={item.status} iconOnly />
          )}
        </span>
        <h2 title={item.title}>{item.title}</h2>
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onClose}
        aria-label={translate('components.sessions.closeView', 'Close session view')}
      >
        <X className="size-4" aria-hidden />
      </Button>
    </div>
  )
}
