import { ArrowLeft, Bell, MessageCircle } from 'lucide-react'

import { useAppStore } from '@/store'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useActivityUnreadCount } from './useActivityUnreadCount'
import { translate } from '@/i18n/i18n'

export function ActivityTitlebarControls(): React.JSX.Element {
  const activityPageScope = useAppStore((s) => s.activityPageScope)
  const temporarySessions = activityPageScope === 'temporary-sessions'
  const unreadCount = useActivityUnreadCount(!temporarySessions, 'agent-events')
  const closeActivityPage = useAppStore((s) => s.closeActivityPage)
  const closeLabel = temporarySessions
    ? translate('components.activity.temporarySessions.close', 'Close temporary sessions')
    : translate('auto.components.activity.ActivityTitlebarControls.dc708f3eff', 'Close agents')

  return (
    <div className="flex h-full min-w-0 flex-1 items-center gap-3 border-l border-border px-3">
      <div
        className="flex min-w-0 items-center gap-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Why: Activity hides the worktree sidebar (full-page surface), so the
            sidebar's nav row isn't available as the back path. This Back button
            is the dedicated exit, mirroring Settings' onBack pattern. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={closeActivityPage}
              aria-label={closeLabel}
            >
              <ArrowLeft className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {closeLabel}
          </TooltipContent>
        </Tooltip>
        {temporarySessions ? (
          <MessageCircle className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <Bell className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate text-xs font-medium">
          {temporarySessions
            ? translate('components.sidebar.sessions.title', 'Temporary sessions')
            : translate('auto.components.activity.ActivityTitlebarControls.d6a8de3934', 'agents')}
        </span>
        {!temporarySessions ? (
          <Badge variant="secondary" className="h-5 px-1.5 text-[11px] font-normal">
            {unreadCount}{' '}
            {translate('auto.components.activity.ActivityTitlebarControls.f915168c8e', 'unread')}
          </Badge>
        ) : null}
      </div>
    </div>
  )
}
