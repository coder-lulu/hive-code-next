import { useState } from 'react'
import { Check, ChevronDown, GitBranch } from 'lucide-react'
import type { SessionListScope } from '../../../../shared/session-list-scope'
import { useAppStore } from '@/store'
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
import { selectSessionCatalog } from './session-catalog'

export default function SessionWorkspaceFilter({
  scope,
  onChange
}: {
  scope: SessionListScope
  onChange: (scope: SessionListScope) => void
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const { entities } = useAppStore(selectSessionCatalog)
  if (scope.kind !== 'project') {
    return null
  }
  const workspaces = entities.projectsByIdentity.get(scope.projectKey)?.workspaces ?? []
  const selected = workspaces.find((workspace) => workspace.identityKey === scope.workspaceKey)
  const allLabel = translate('components.sessions.allWorkspaces', 'All workspaces')
  const label = scope.workspaceKey
    ? (selected?.name ??
      translate('components.sessions.workspaceUnavailable', 'Workspace unavailable'))
    : allLabel
  const selectWorkspace = (workspaceKey?: string) => {
    onChange({
      kind: 'project',
      projectKey: scope.projectKey,
      ...(workspaceKey ? { workspaceKey } : {})
    })
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="min-w-0 max-w-full gap-1.5 px-2 text-muted-foreground"
          aria-label={translate('components.sessions.filterWorkspace', 'Filter by workspace')}
          data-testid="session-workspace-filter"
        >
          <GitBranch className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3 shrink-0" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput
            placeholder={translate('components.sessions.searchWorkspaces', 'Search workspaces…')}
          />
          <CommandList>
            <CommandEmpty>
              {translate('components.sessions.noWorkspaces', 'No matching workspace')}
            </CommandEmpty>
            <CommandItem value="all" onSelect={() => selectWorkspace()}>
              <span className="min-w-0 flex-1 truncate">{allLabel}</span>
              {!scope.workspaceKey && <Check className="size-3 shrink-0" aria-hidden />}
            </CommandItem>
            {workspaces.map((workspace) => (
              <CommandItem
                key={workspace.identityKey}
                value={workspace.identityKey}
                keywords={[workspace.name, workspace.branch, workspace.repoName, workspace.path]}
                onSelect={() => selectWorkspace(workspace.identityKey)}
              >
                <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                <span className="max-w-24 truncate text-xs text-muted-foreground">
                  {workspace.repoName}
                </span>
                {scope.workspaceKey === workspace.identityKey && (
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
