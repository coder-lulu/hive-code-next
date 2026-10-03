import React from 'react'
import { useTranslation } from 'react-i18next'
import { GitCommitHorizontal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  getWorktreeGitIdentityDisplay,
  type WorktreeGitIdentityDisplay
} from '@/lib/worktree-git-identity-display'

type DetachedHeadDisplay = Extract<WorktreeGitIdentityDisplay, { kind: 'detached' }>

type DetachedHeadBadgeProps = {
  display: DetachedHeadDisplay
  label?: 'sidebar' | 'source-control'
  side?: React.ComponentProps<typeof TooltipContent>['side']
  className?: string
  tabIndex?: number
}

export function DetachedHeadBadge({
  display,
  label = 'source-control',
  side = 'right',
  className,
  tabIndex
}: DetachedHeadBadgeProps): React.JSX.Element {
  useTranslation()
  // Why: callers may memoize the Git identity independently of the UI language.
  const localizedDisplay = getWorktreeGitIdentityDisplay({
    head: display.shortHead
  }) as DetachedHeadDisplay
  const visibleLabel =
    label === 'sidebar' ? localizedDisplay.sidebarLabel : localizedDisplay.sourceControlLabel

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          aria-label={localizedDisplay.tooltip}
          tabIndex={tabIndex}
          className={cn(
            'h-[18px] shrink-0 gap-1 rounded px-1.5 text-[10px] font-medium leading-none',
            'border-[color:color-mix(in_srgb,var(--git-decoration-modified)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--git-decoration-modified)_8%,transparent)] text-[color:var(--git-decoration-modified)]',
            className
          )}
        >
          <GitCommitHorizontal className="size-2.5" />
          <span className="min-w-0 truncate">{visibleLabel}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent side={side} sideOffset={8}>
        {localizedDisplay.tooltip}
      </TooltipContent>
    </Tooltip>
  )
}
