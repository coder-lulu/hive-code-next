import { MessagesSquare } from 'lucide-react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'

export default function SidebarSessionsNavButton(): React.JSX.Element {
  const active = useAppStore((state) => state.activeView === 'sessions')
  const openSessionsPage = useAppStore((state) => state.openSessionsPage)
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        'w-full justify-start gap-2 px-2 text-[13px]',
        active
          ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
          : 'text-worktree-sidebar-foreground/60 hover:bg-worktree-sidebar-foreground/8'
      )}
      aria-current={active ? 'page' : undefined}
      onClick={() => openSessionsPage()}
    >
      <MessagesSquare className="size-4 shrink-0" />
      {translate('components.sessions.title', 'Sessions')}
    </Button>
  )
}
