import { Check, LoaderCircle, MoreHorizontal, Monitor } from 'lucide-react'
import { LinearIcon } from '@/components/icons/LinearIcon'
import { LinearApiKeyDialog } from '@/components/linear-api-key-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem
} from '@/components/ui/dropdown-menu'
import { useAppStore } from '@/store'
import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
import { translate } from '@/i18n/i18n'
import { IntegrationCardShell } from './integration-card-shell'
import { integrationText as text } from './integration-settings-row'
import { getProviderAccountScope } from './provider-account-scope'
import { LinearAgentSkillInstallCta } from './linear-agent-skill-install-cta'
import { useLinearWorkspaceManagement } from './use-linear-workspace-management'
export function LinearSettingsIntegration() {
  const settings = useAppStore((state) => state.settings)
  const status = useAppStore((state) => state.linearStatus)
  const statusError = useAppStore((state) => state.linearStatusError)
  const checked = useAppStore((state) => state.linearStatusChecked)
  const context = useAppStore((state) => state.linearStatusContextKey)
  const refresh = useAppStore((state) => state.checkLinearConnection)
  const runtimeName = useAppStore(
    (state) =>
      state.runtimeEnvironments?.find(
        (environment) => environment.id === settings?.activeRuntimeEnvironmentId
      )?.name
  )
  const scope = runtimeName || getProviderAccountScope(settings).label
  const current = context === getProviderRuntimeContextKey(settings)
  const checking = !current || !checked
  const connected = current && status.connected
  const workspaces = current ? (status.workspaces ?? []) : []
  const {
    testing,
    results,
    authorizationCompleted,
    editingWorkspace,
    setEditingWorkspace,
    authorize,
    setAuthorize,
    remove,
    setRemove,
    removing,
    error,
    setError,
    runTest,
    removeWorkspace
  } = useLinearWorkspaceManagement()
  const add = (
    <Button
      variant="outline"
      disabled={checking}
      onClick={() => {
        setEditingWorkspace(null)
        setAuthorize(true)
      }}
    >
      {text('addWorkspace', 'Add workspace')}
    </Button>
  )
  return (
    <IntegrationCardShell
      icon={<LinearIcon />}
      name="Linear"
      settingsSectionId="integrations-linear"
      description={
        connected
          ? translate(
              'components.integrationSettings.workspaceCount',
              '{{count}} workspaces connected',
              { count: workspaces.length }
            )
          : text('linearDescription', 'Browse and link issues')
      }
      statusLabel={
        current && statusError
          ? text('unavailable', 'Temporarily unavailable')
          : current && status.credentialError
            ? text('verificationFailed', 'Verification failed')
            : connected
              ? text('connected', 'Connected')
              : text('notConnected', 'Not connected')
      }
      statusTone={
        current && (statusError || status.credentialError)
          ? 'attention'
          : connected
            ? 'connected'
            : 'neutral'
      }
      checking={checking}
    >
      <div className="space-y-6">
        {current && (statusError || status.credentialError) && (
          <p role="alert" className="text-destructive">
            {statusError || status.credentialError}
          </p>
        )}
        <div className="flex items-center gap-2 text-muted-foreground">
          <Monitor className="size-4" />
          {scope}
        </div>
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-semibold">
              {text('connectedWorkspaces', 'Connected workspaces')}
            </h3>
            {add}
          </div>
          {workspaces.length > 0 ? (
            <div className="integration-workspace-list">
              {workspaces.map((workspace) => (
                <div key={workspace.id} className="integration-workspace-row">
                  <div className="integration-workspace-identity">
                    <p className="font-medium">{workspace.organizationName}</p>
                    <p className="text-muted-foreground">
                      {[workspace.displayName, workspace.email].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <span
                    className={
                      results[workspace.id]?.ok ? 'text-status-success' : 'text-muted-foreground'
                    }
                  >
                    {results[workspace.id]?.ok
                      ? text('verified', 'Verified')
                      : results[workspace.id]
                        ? text('verificationFailed', 'Verification failed')
                        : text('notVerified', 'Not verified')}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={testing.has(workspace.id)}
                    onClick={() => void runTest(workspace.id)}
                  >
                    {testing.has(workspace.id) && (
                      <LoaderCircle className="size-4 motion-safe:animate-spin" />
                    )}
                    {text('testConnection', 'Test connection')}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${text('more', 'More actions')} ${workspace.organizationName}`}
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="z-[110]">
                      <DropdownMenuItem
                        onSelect={() => {
                          setEditingWorkspace(workspace)
                          setAuthorize(true)
                        }}
                      >
                        {text('updateAccess', 'Update access')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={testing.has(workspace.id)}
                        onSelect={() => {
                          setError(null)
                          setRemove({ id: workspace.id, name: workspace.organizationName })
                        }}
                      >
                        {text('removeAccess', 'Remove access')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {results[workspace.id] && !results[workspace.id].ok && (
                    <p role="alert" className="basis-full text-destructive break-words">
                      {results[workspace.id].error ||
                        text(
                          'testFailed',
                          'Could not test this workspace. Retry or update its access key.'
                        )}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : !checking && !statusError ? (
            <p className="text-muted-foreground">
              {text('noWorkspaces', 'No workspace access configured.')}
            </p>
          ) : null}
          <p className="text-muted-foreground">
            {text('independentKeys', 'Each workspace manages its own access key.')}
          </p>
        </section>
        <section className="space-y-3">
          <h3 className="text-base font-semibold">
            {text('capabilities', 'Available capabilities')}
          </h3>
          <p className="flex gap-2">
            <Check className="size-4" />
            {text('linearDescription', 'Browse and link issues')}
          </p>
          <p className="flex gap-2">
            <Check className="size-4" />
            {text('workspaceContext', 'Create workspaces with task context')}
          </p>
        </section>
        <section className="space-y-3">
          <h3 className="text-base font-semibold">
            {text('connectionInfo', 'Connection information')}
          </h3>
          <dl className="integration-connection-info">
            <div>
              <dt>{text('location', 'Connection location')}</dt>
              <dd>{scope}</dd>
            </div>
            <div>
              <dt>{text('authMethod', 'Authorization method')}</dt>
              <dd>{text('personalApiKey', 'Personal API Key')}</dd>
            </div>
            <div>
              <dt>{text('workspaceNumber', 'Workspaces')}</dt>
              <dd>{checking || statusError ? '—' : workspaces.length}</dd>
            </div>
          </dl>
        </section>
        <details>
          <summary className="cursor-pointer font-medium">
            {text('advanced', 'Advanced configuration and diagnostics')}
          </summary>
          <div className="mt-4 space-y-3">
            <p className="text-muted-foreground">{getProviderAccountScope(settings).description}</p>
            <Button variant="outline" onClick={() => void refresh(true)}>
              {text('recheck', 'Re-check')}
            </Button>
            <LinearAgentSkillInstallCta settings={settings} />
          </div>
        </details>
        <p className="text-muted-foreground">
          {text('removeNotice', 'Removing access does not delete issues in Linear.')}
        </p>
      </div>
      <LinearApiKeyDialog
        open={authorize}
        onOpenChange={setAuthorize}
        workspace={editingWorkspace}
        onConnected={authorizationCompleted}
        overlayClassName="z-[110]"
        contentClassName="z-[120]"
      />
      <Dialog
        open={remove !== null}
        onOpenChange={(open) => {
          if (!open && !removing) {
            setRemove(null)
          }
        }}
      >
        <DialogContent overlayClassName="z-[110]" className="z-[120]">
          <DialogTitle>
            {text('removeAccess', 'Remove access')}: {remove?.name}
          </DialogTitle>
          <DialogDescription>
            {text('removeNotice', 'Removing access does not delete issues in Linear.')} {scope}
          </DialogDescription>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={removing} onClick={() => setRemove(null)}>
              {text('cancel', 'Cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={removing}
              onClick={() => void removeWorkspace()}
            >
              {text('removeAccess', 'Remove access')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </IntegrationCardShell>
  )
}
