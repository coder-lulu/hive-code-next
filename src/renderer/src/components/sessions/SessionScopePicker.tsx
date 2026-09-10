import { useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import type { SessionListScope } from '../../../../shared/session-list-scope'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import type { SessionListItem, SessionProjectOption } from './session-list-types'

export function sessionScopeLabel(
  scope: SessionListScope,
  items: readonly SessionListItem[],
  projects: readonly SessionProjectOption[]
): string {
  if (scope.kind === 'project') {
    return (
      projects.find((project) => project.key === scope.projectKey)?.label ??
      translate('components.sessions.projectScope', 'Project sessions')
    )
  }
  if (scope.kind === 'workspace') {
    return (
      items.find(
        (item) =>
          item.executionHostId === scope.executionHostId &&
          item.worktreeId === scope.workspaceKey.replace(/^worktree:/, '')
      )?.workspaceLabel ?? translate('components.sessions.workspaceScope', 'Workspace sessions')
    )
  }
  return scope.kind === 'unassigned'
    ? translate('components.sessions.unassigned', 'Unassigned')
    : translate('components.sessions.all', 'All sessions')
}

export default function SessionScopePicker({
  scope,
  items,
  projects,
  onChange
}: {
  scope: SessionListScope
  items: readonly SessionListItem[]
  projects: readonly SessionProjectOption[]
  onChange: (scope: SessionListScope) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const workspaces = [
    ...new Map(
      items
        .filter((item) => item.workspaceLabel && item.executionHostId)
        .map((item) => [item.ownerBucketKey, item])
    ).values()
  ]
  const options: { key: string; label: string; detail?: string; scope: SessionListScope }[] = [
    {
      key: 'all',
      label: translate('components.sessions.all', 'All sessions'),
      scope: { kind: 'all' }
    },
    {
      key: 'unassigned',
      label: translate('components.sessions.unassigned', 'Unassigned'),
      scope: { kind: 'unassigned' }
    },
    ...projects.map((project) => ({
      key: project.key,
      label: project.label,
      detail: project.hostLabel,
      scope: { kind: 'project' as const, projectKey: project.key }
    })),
    ...workspaces.map((item) => ({
      key: `workspace:${item.ownerBucketKey}`,
      label: item.workspaceLabel!,
      detail: item.hostLabel,
      scope: {
        kind: 'workspace' as const,
        workspaceKey: item.worktreeId!,
        executionHostId: item.executionHostId!
      }
    }))
  ]
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="min-w-0 max-w-full gap-1.5 px-2"
          aria-label={translate('components.sessions.scope', 'Session scope')}
        >
          <span className="truncate">{sessionScopeLabel(scope, items, projects)}</span>
          <ChevronDown className="size-3 shrink-0" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput
            placeholder={translate(
              'components.sessions.searchScopes',
              'Search projects or workspaces…'
            )}
          />
          <CommandList>
            <CommandEmpty>
              {translate('components.sessions.noScopes', 'No matching scope')}
            </CommandEmpty>
            {options.map((option) => (
              <CommandItem
                key={option.key}
                value={option.key}
                keywords={[option.label, option.detail ?? '']}
                onSelect={() => {
                  onChange(option.scope)
                  setOpen(false)
                }}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                <span className="max-w-24 truncate text-xs text-muted-foreground">
                  {option.detail}
                </span>
                {JSON.stringify(option.scope) === JSON.stringify(scope) && (
                  <Check className="size-3 shrink-0" aria-hidden />
                )}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
