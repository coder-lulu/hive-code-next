import { useState } from 'react'
import { GitBranchPlus, MessageSquarePlus, Plus } from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { getRepoExecutionHostId } from '../../../../shared/execution-host'
import { isGitRepoKind } from '../../../../shared/repo-kind'
import type { SessionListScope } from '../../../../shared/session-list-scope'
import { selectExecutionHostDisplayLabel } from '@/lib/execution-host-display-label'
import { selectSessionCatalog } from './session-catalog'
import SessionCreateDialog from './SessionCreateDialog'

export default function SessionCreationMenu({
  scope,
  returnToSessions = true,
  showLabel = false
}: {
  scope: SessionListScope
  returnToSessions?: boolean
  showLabel?: boolean
}): React.JSX.Element {
  const [mode, setMode] = useState<'session' | 'worktree' | null>(null)
  const [repoKey, setRepoKey] = useState('')
  const catalog = useAppStore(selectSessionCatalog)
  const repos = useAppStore((s) => s.repos)
  const openModal = useAppStore((s) => s.openModal)
  const project =
    scope.kind === 'project'
      ? catalog.entities.projectsByIdentity.get(scope.projectKey)
      : scope.kind === 'workspace'
        ? [...catalog.entities.projectsByIdentity.values()].find((candidate) =>
            candidate.workspaces.some(
              (workspace) =>
                workspace.executionHostId === scope.executionHostId &&
                [workspace.id, workspace.workspaceKey].includes(scope.workspaceKey)
            )
          )
        : undefined
  const restricted = scope.kind === 'project' || scope.kind === 'workspace'
  const eligible = repos.filter(
    (repo) =>
      (!restricted || Boolean(project)) &&
      isGitRepoKind(repo) &&
      (!project ||
        (project.repoIds.includes(repo.id) &&
          getRepoExecutionHostId(repo) === project.executionHostId))
  )
  const keyFor = (repo: (typeof repos)[number]): string =>
    `${getRepoExecutionHostId(repo)}|${repo.id}`
  const selected =
    eligible.find((repo) => keyFor(repo) === repoKey) ??
    (!repoKey && eligible.length === 1 ? eligible[0] : undefined)
  const createWorktree = (): void => {
    if (!selected) {
      return
    }
    setMode(null)
    openModal('new-workspace-composer', {
      initialRepoId: selected.id,
      initialExecutionHostId: getRepoExecutionHostId(selected),
      returnToSessions,
      telemetrySource: 'sidebar'
    })
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size={showLabel ? 'sm' : 'icon-xs'}
            aria-label={translate('components.sessions.new', 'New session')}
          >
            <Plus className="size-4" aria-hidden />
            {showLabel && translate('components.sessions.new', 'New session')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setMode('session')}>
            <MessageSquarePlus className="size-4" />
            {translate('components.sessions.new', 'New session')}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!eligible.length || (scope.kind === 'project' && !project)}
            onSelect={() => setMode('worktree')}
          >
            <GitBranchPlus className="size-4" />
            {translate('components.sessions.newWorktree', 'New worktree')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {mode === 'session' && (
        <SessionCreateDialog
          returnToSessions={returnToSessions}
          scope={scope}
          onClose={() => setMode(null)}
        />
      )}
      <Dialog
        open={mode === 'worktree'}
        onOpenChange={(open) => {
          if (!open) {
            setMode(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {translate('components.sessions.newWorktree', 'New worktree')}
            </DialogTitle>
            <DialogDescription>
              {translate(
                'components.sessions.chooseWorktreeRepo',
                'Choose the repository and device for the new worktree.'
              )}
            </DialogDescription>
          </DialogHeader>
          <Select value={selected ? keyFor(selected) : ''} onValueChange={setRepoKey}>
            <SelectTrigger
              className="w-full"
              aria-label={translate('components.sessions.repository', 'Repository')}
            >
              <SelectValue
                placeholder={translate('components.sessions.repository', 'Repository')}
              />
            </SelectTrigger>
            <SelectContent>
              {eligible.map((repo) => (
                <SelectItem key={keyFor(repo)} value={keyFor(repo)}>
                  {repo.displayName} ·{' '}
                  {selectExecutionHostDisplayLabel(
                    useAppStore.getState(),
                    getRepoExecutionHostId(repo)
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button disabled={!selected} onClick={createWorktree}>
            {translate('components.sessions.continueCreate', 'Continue')}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
