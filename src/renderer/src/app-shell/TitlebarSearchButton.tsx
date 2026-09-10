import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { useShortcutKeyComboDetails } from '@/hooks/useShortcutLabel'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'

export function TitlebarSearchButton(): React.JSX.Element {
  useTranslation()
  const openModal = useAppStore((s) => s.openModal)
  const sidebarWidth = useAppStore((s) => s.sidebarWidth)
  const shortcuts = useShortcutKeyComboDetails('worktree.palette')
  const label = translate(
    'auto.components.sidebar.SidebarNav.0c3395fd32',
    'Search worktrees and browser tabs'
  )

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="h-7 justify-start gap-2 text-muted-foreground shadow-none"
          style={{ width: `calc(${sidebarWidth}px - var(--spacing) * 4)` }}
          aria-label={label}
          onClick={() => openModal('worktree-palette')}
        >
          <Search className="size-3" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate text-left">
            {translate('auto.components.sidebar.SidebarNav.80611a8b10', 'Search')}
          </span>
          <span className="pointer-events-none ml-auto inline-flex shrink-0 items-center gap-1.5">
            {shortcuts.map((combo) => (
              <ShortcutKeyCombo
                key={combo.keys.join('-')}
                keys={combo.keys}
                doubleTap={combo.doubleTap}
                className="inline-flex gap-0.5"
                keyCapClassName="min-w-4 border-border bg-muted px-1 py-px text-[9px] text-muted-foreground shadow-none"
                separatorClassName="text-[9px] text-muted-foreground"
              />
            ))}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className="flex items-center gap-1.5">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
