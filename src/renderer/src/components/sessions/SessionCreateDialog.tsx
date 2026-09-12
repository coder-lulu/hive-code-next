import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoaderCircle } from 'lucide-react'
import { useAppStore } from '@/store'
import { activateWorktreeFromSidebar } from '@/lib/sidebar-worktree-activation'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useDetectedAgents } from '@/hooks/useDetectedAgents'
import { getAgentCatalog } from '@/lib/agent-catalog'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import {
  DEFAULT_DISABLED_TUI_AGENTS,
  filterEnabledTuiAgents
} from '../../../../shared/tui-agent-selection'
import type { TuiAgent } from '../../../../shared/tui-agent'
import type { SessionListScope } from '../../../../shared/session-list-scope'
import { selectSessionCatalog } from './session-catalog'
import { createSessionLaunchTracker } from './session-launch-tracker'
import {
  sessionCreateDetectionTarget,
  sessionCreateOwner,
  sessionCreateWorkspaces
} from './session-create-model'

export default function SessionCreateDialog({
  scope,
  onClose,
  returnToSessions = true
}: {
  scope: SessionListScope
  returnToSessions?: boolean
  onClose: () => void
}) {
  useTranslation()
  const { entities } = useAppStore(selectSessionCatalog)
  const workspaces = sessionCreateWorkspaces(entities, scope)
  const allowTemporary = scope.kind === 'all' || scope.kind === 'unassigned'
  const [workspaceId, setWorkspaceId] = useState(
    () => workspaces[0]?.identityKey ?? (allowTemporary ? 'temporary' : '')
  )
  const workspace = workspaces.find((w) => w.identityKey === workspaceId)
  const validWorkspace = Boolean(workspace) || (allowTemporary && workspaceId === 'temporary')
  const detection = useDetectedAgents(
    validWorkspace ? sessionCreateDetectionTarget(workspace) : undefined
  )
  const disabled = useAppStore((s) => s.settings?.disabledTuiAgents ?? DEFAULT_DISABLED_TUI_AGENTS)
  const agents = filterEnabledTuiAgents(detection.detectedIds ?? [], disabled)
  const [agent, setAgent] = useState<TuiAgent | ''>('')
  const selectedAgent = agent && agents.includes(agent) ? agent : agents[0]
  const [prompt, setPrompt] = useState('')
  const [pending, setPending] = useState(false)
  const [unknown, setUnknown] = useState(false)
  const [error, setError] = useState('')
  const cleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => cleanup.current?.(), [])
  const launch = () => {
    if (!selectedAgent || !validWorkspace || pending || unknown) {
      return
    }
    const owner = sessionCreateOwner(workspace)
    // Raw tab buckets cannot safely address duplicate workspace IDs on different hosts.
    const owners = entities.workspaces.filter(
      (w) => sessionCreateOwner(w).worktreeId === owner.worktreeId
    )
    if (new Set(owners.map((w) => w.executionHostId)).size > 1) {
      setError(
        translate(
          'components.sessions.create.ambiguous',
          'This workspace has multiple execution owners. Open it from project management.'
        )
      )
      return
    }
    setPending(true)
    setError('')
    const tracker = createSessionLaunchTracker({
      ownerWorktreeId: owner.worktreeId,
      executionHostId: owner.executionHostId,
      agent: selectedAgent,
      onMatch: (item) => {
        if (returnToSessions) {
          useAppStore.getState().openSessionsPage(scope)
          useAppStore.getState().updateSessionsView({ selectedSessionKey: item.key })
        } else {
          void activateWorktreeFromSidebar(owner.worktreeId, owner.executionHostId)
        }
        onClose()
      },
      onTimeout: () => {
        setPending(false)
        setUnknown(true)
        setError(
          translate(
            'components.sessions.create.unknown',
            'The session has not appeared yet. Check the session list before starting another.'
          )
        )
      }
    })
    cleanup.current = tracker.stop
    try {
      const result = launchAgentInNewTab({
        agent: selectedAgent,
        ...owner,
        prompt: prompt.trim() || undefined
      })
      if (!result) {
        throw new Error(
          translate('components.sessions.create.failed', 'Could not start the session.')
        )
      }
      tracker.markLaunched(result.tabId)
    } catch (cause) {
      tracker.stop()
      setPending(false)
      // A launcher can throw after publishing its intent; never create a duplicate automatically.
      setUnknown(true)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{translate('components.sessions.create.title', 'New session')}</DialogTitle>
          <DialogDescription>
            {translate(
              'components.sessions.create.description',
              'Start an agent in an existing workspace or a local temporary session.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="session-create-workspace">
              {translate('components.sessions.create.workspace', 'Workspace')}
            </label>
            <Select
              value={workspaceId}
              onValueChange={(value) => {
                setWorkspaceId(value)
                setAgent('')
                setError('')
              }}
              disabled={pending || unknown}
            >
              <SelectTrigger id="session-create-workspace" className="w-full">
                <SelectValue
                  placeholder={translate(
                    'components.sessions.create.chooseWorkspace',
                    'Choose a workspace'
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                {allowTemporary && (
                  <SelectItem value="temporary">
                    {translate('components.sessions.create.temporary', 'Local temporary session')}
                  </SelectItem>
                )}
                {workspaces.map((w) => (
                  <SelectItem key={w.identityKey} value={w.identityKey}>
                    {w.repoName} / {w.name} · {w.executionHostId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!validWorkspace && (
              <p className="text-sm text-muted-foreground">
                {translate(
                  'components.sessions.create.noWorkspace',
                  'Create a workspace in this project first.'
                )}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <label htmlFor="session-create-agent">
              {translate('components.sessions.create.agent', 'Agent')}
            </label>
            <Select
              value={selectedAgent ?? ''}
              onValueChange={(value) => setAgent(value as TuiAgent)}
              disabled={!validWorkspace || pending || unknown || detection.isLoading}
            >
              <SelectTrigger id="session-create-agent" className="w-full">
                <SelectValue
                  placeholder={translate(
                    'components.sessions.create.chooseAgent',
                    'Choose an installed agent'
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                {getAgentCatalog()
                  .filter((a) => agents.includes(a.id))
                  .map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {validWorkspace && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {detection.isLoading ? (
                  <LoaderCircle className="size-4 motion-safe:animate-spin" />
                ) : agents.length === 0 ? (
                  translate(
                    'components.sessions.create.noAgents',
                    'No enabled agents detected on this host.'
                  )
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending || unknown || detection.isLoading || detection.isRefreshing}
                  onClick={() => {
                    void detection.refresh().catch((cause) => setError(String(cause)))
                  }}
                >
                  {translate('components.sessions.create.refresh', 'Refresh agents')}
                </Button>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <label htmlFor="session-create-prompt">
              {translate('components.sessions.create.prompt', 'Initial message (optional)')}
            </label>
            <Textarea
              id="session-create-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              disabled={pending || unknown}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {translate('common.close', 'Close')}
          </Button>
          <Button
            onClick={launch}
            disabled={
              !validWorkspace || !selectedAgent || detection.isLoading || pending || unknown
            }
          >
            {pending && <LoaderCircle className="size-4 motion-safe:animate-spin" />}
            {translate('components.sessions.create.start', 'Start session')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
