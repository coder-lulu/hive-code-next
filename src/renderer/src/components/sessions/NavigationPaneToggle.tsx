import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'

export default function NavigationPaneToggle({
  collapsed,
  onToggle,
  controlsId,
  kind
}: {
  collapsed: boolean
  onToggle: () => void
  controlsId: string
  kind: 'sessions' | 'projects'
}): React.JSX.Element {
  const label =
    kind === 'sessions'
      ? collapsed
        ? translate('components.sessions.expandSessions', 'Expand sessions pane')
        : translate('components.sessions.collapseSessions', 'Collapse sessions pane')
      : collapsed
        ? translate('components.sessions.expandProjects', 'Expand projects pane')
        : translate('components.sessions.collapseProjects', 'Collapse projects pane')
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="navigation-pane-toggle shrink-0 text-muted-foreground"
      aria-label={label}
      title={label}
      aria-expanded={!collapsed}
      aria-controls={controlsId}
      onClick={onToggle}
    >
      <Icon className="size-4" aria-hidden />
    </Button>
  )
}
