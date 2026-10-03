import { AlertTriangle, Loader2, Pencil, Server, ServerOff, Trash2 } from 'lucide-react'
import type { PublicKnownRuntimeEnvironment } from '../../../../shared/runtime-environments'
import type { RemoteServerUpdateEntry } from '@/runtime/remote-server-update-coordinator'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { resolveHostDisplay } from '../../../../shared/host-display-resolution'
import { lastVerifiedRuntimeStatus } from '../../../../shared/runtime-host-status'
import {
  isConnectedRuntimeHostState,
  runtimeHostConnectionStateForEntry
} from '@/runtime/runtime-host-connection-state'
import { useAppStore } from '@/store'
import { Button } from '../ui/button'
import {
  getHostDetailsDescription,
  getHostDetailsSummary,
  getAccountRuntimeConnectionHelp,
  getRuntimeEnvironmentRemovalPresentation,
  evaluateHostDetails,
  getRuntimeServerConnectionLabel,
  getRuntimeServerConnectionState,
  getRuntimeServerDotClass,
  isRuntimeServerTransportConnected,
  canConnectRuntimeEnvironment,
  type RuntimeHostDetails
} from './runtime-environment-host-details'
import {
  getRemoteServerManualUpdateHelp,
  RemoteServerUpdateStatus
} from './RemoteServerUpdateStatus'

type RuntimeServerRowProps = {
  environment: PublicKnownRuntimeEnvironment
  details: RuntimeHostDetails | undefined
  isActive: boolean
  remoteUpdate: RemoteServerUpdateEntry | undefined
  remoteServerUpdatesRunning: boolean
  connecting: boolean
  switching: boolean
  disconnecting: boolean
  removing: boolean
  isBusy: boolean
  onOpenUpdate: () => void
  onDisconnect: (environment: PublicKnownRuntimeEnvironment) => void
  onConnect: (environment: PublicKnownRuntimeEnvironment) => void
  onRemove: (environment: PublicKnownRuntimeEnvironment) => void
  canRenameCloud: boolean
  onRenameCloud: (environment: PublicKnownRuntimeEnvironment) => void
}

export function RuntimeServerRow({
  environment,
  details,
  isActive,
  remoteUpdate,
  remoteServerUpdatesRunning,
  connecting,
  switching,
  disconnecting,
  removing,
  isBusy,
  onOpenUpdate,
  onDisconnect,
  onConnect,
  onRemove,
  canRenameCloud,
  onRenameCloud
}: RuntimeServerRowProps): React.JSX.Element {
  const runtimeStatusEntry = useAppStore((state) =>
    state.runtimeStatusByEnvironmentId.get(environment.id)
  )
  // Why the shared verdict and not `entry.status`: an unverifiable probe nulls it while the
  // transport is still up, and this row then read "error" and offered Connect for a host that
  // RepositoryHostSetupsSection -- which already derives through this same function -- was
  // showing as reachable. One host, two surfaces, opposite answers. A probe that did not come
  // back is not a host that went away (docs/reference/ssh-execution-boundary.md).
  const entryReachable =
    runtimeStatusEntry !== undefined &&
    isConnectedRuntimeHostState(runtimeHostConnectionStateForEntry(runtimeStatusEntry))
  const effectiveDetails = runtimeStatusEntry
    ? {
        ...(details ?? {
          status: entryReachable ? ('ready' as const) : ('error' as const),
          runtimeStatus: null,
          compatibility: null,
          error: null
        }),
        status: entryReachable ? ('ready' as const) : ('error' as const),
        runtimeStatus: runtimeStatusEntry.status,
        compatibility: runtimeStatusEntry.status
          ? evaluateHostDetails(runtimeStatusEntry.status)
          : null,
        remoteControl:
          runtimeStatusEntry.remoteControl ?? runtimeStatusEntry.status?.remoteControl ?? null
      }
    : details
  const detailsDescription = getHostDetailsDescription(effectiveDetails)
  const connectionState =
    details?.status === 'loading' && !runtimeStatusEntry?.status
      ? 'checking'
      : getRuntimeServerConnectionState(effectiveDetails, environment)
  // A connected host exposes Disconnect; otherwise Connect.
  const isReachable = isRuntimeServerTransportConnected(connectionState)
  const actionBusy = connecting || switching || disconnecting || removing
  const canConnect = canConnectRuntimeEnvironment(environment)
  const removalPresentation = getRuntimeEnvironmentRemovalPresentation(environment, isActive)
  const accountConnectionHelp = getAccountRuntimeConnectionHelp(connectionState)
  // Why: the snapshot keeps the last answered status across a lost probe; `status` is only the latest answer.
  const descriptorStatus = lastVerifiedRuntimeStatus(runtimeStatusEntry)
  const hostDisplay = resolveHostDisplay({
    name: environment.name,
    machineName: descriptorStatus?.machineName,
    platform: descriptorStatus?.hostPlatform
  })
  const hostDescriptorText = hostDisplay.descriptorLine

  return (
    <div data-settings-section={environment.id} className="flex items-center gap-3 px-4 py-3">
      <Server className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <div className="truncate text-sm font-medium">{hostDisplay.title}</div>
          <span
            className={cn(
              'size-2 shrink-0 rounded-full',
              getRuntimeServerDotClass(connectionState)
            )}
          />
          <span className="text-[11px] text-muted-foreground">
            {getRuntimeServerConnectionLabel(connectionState)}
          </span>
          {effectiveDetails?.compatibility?.kind === 'blocked' ? (
            <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
          ) : effectiveDetails?.status === 'loading' ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
          ) : null}
        </div>
        {hostDescriptorText ? (
          <p className="truncate text-xs text-muted-foreground">{hostDescriptorText}</p>
        ) : null}
        <p className="truncate text-xs text-muted-foreground">
          {environment.connectionDependency === 'ssh-tunnel'
            ? translate(
                'auto.components.settings.RuntimeEnvironmentsPane.sshTunnelRequired',
                'SSH tunnel required'
              )
            : isActive
              ? translate(
                  'auto.components.settings.RuntimeEnvironmentsPane.activeServerRowHelp',
                  'Active server for server-routed projects, terminals, and provider checks.'
                )
              : (accountConnectionHelp ?? getHostDetailsSummary(effectiveDetails))}
        </p>
        {detailsDescription ? (
          <p
            className={cn(
              'mt-0.5 truncate text-xs',
              effectiveDetails?.compatibility?.kind === 'blocked'
                ? 'text-destructive'
                : 'text-muted-foreground'
            )}
          >
            {detailsDescription}
          </p>
        ) : null}
        {remoteUpdate ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              {remoteUpdate.currentVersion
                ? translate(
                    'auto.components.settings.RuntimeEnvironmentsPane.orcaVersion',
                    'Orca v{{value0}}',
                    { value0: remoteUpdate.currentVersion }
                  )
                : translate(
                    'auto.components.settings.RuntimeEnvironmentsPane.versionUnavailable',
                    'Orca version unavailable'
                  )}
            </span>
            <RemoteServerUpdateStatus entry={remoteUpdate} compact />
          </div>
        ) : null}
        {remoteUpdate?.phase === 'manual' ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {getRemoteServerManualUpdateHelp(remoteUpdate)}
          </p>
        ) : null}
        {remoteUpdate?.phase === 'failed' && remoteUpdate.error ? (
          <p className="mt-1 text-xs text-destructive">{remoteUpdate.error}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {environment.accountClaim?.cloudDisplayNameVersion != null ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            onClick={() => onRenameCloud(environment)}
            disabled={isBusy || !canRenameCloud}
            aria-label={translate(
              'auto.components.settings.RuntimeEnvironmentsPane.renameCloudRuntime',
              'Rename HiveCloud Runtime'
            )}
          >
            <Pencil className="size-3" />
          </Button>
        ) : null}
        {remoteUpdate?.phase === 'available' || remoteUpdate?.phase === 'failed' ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={onOpenUpdate}
            disabled={remoteServerUpdatesRunning}
          >
            {translate('auto.components.settings.RuntimeEnvironmentsPane.updateServer', 'Update')}
          </Button>
        ) : null}
        {isReachable ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="gap-1.5"
            onClick={() => onDisconnect(environment)}
            disabled={actionBusy}
          >
            {disconnecting ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <ServerOff className="size-3" />
            )}
            {translate('auto.components.settings.RuntimeEnvironmentsPane.disconnect', 'Disconnect')}
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="gap-1.5"
            onClick={() => onConnect(environment)}
            disabled={actionBusy || connectionState === 'checking' || !canConnect}
          >
            {connecting ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Server className="size-3" />
            )}
            {translate('auto.components.settings.RuntimeEnvironmentsPane.connect', 'Connect')}
          </Button>
        )}
        {removalPresentation ? <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onRemove(environment)}
          className="size-7 text-muted-foreground hover:text-red-400"
          disabled={isBusy}
          aria-label={removalPresentation.actionAriaLabel}
        >
          {removing ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
        </Button> : null}
      </div>
    </div>
  )
}
