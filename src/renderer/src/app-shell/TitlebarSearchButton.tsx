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
          className="text-muted-foreground shadow-none"
          aria-label={label}
          onClick={() => openModal('worktree-palette')}
        >
          <Search className="size-3" strokeWidth={1.75} />
          {translate('auto.components.sidebar.SidebarNav.80611a8b10', 'Search')}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className="flex items-center gap-1.5">
        {label}
        {shortcuts.map((combo) => (
          <ShortcutKeyCombo
            key={combo.keys.join('-')}
            keys={combo.keys}
            doubleTap={combo.doubleTap}
          />
        ))}
      </TooltipContent>
    </Tooltip>
  )
}
