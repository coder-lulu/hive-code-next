import { translate } from '@/i18n/i18n'
import { isHiveRuntimeControlPlaneOnline } from '../../../../shared/hive-runtime-connectivity'
import type { PublicKnownRuntimeEnvironment } from '../../../../shared/runtime-environments'
import {
  isConnectedRuntimeHostState,
  runtimeHostConnectionState,
  type RuntimeHostConnectionState
} from '@/runtime/runtime-host-connection-state'
import type { RuntimeHostDetails } from './runtime-environment-host-details'
import { supportsLocalRuntimeEnvironmentRemoval } from './runtime-environment-host-details-account'

export type RuntimeServerConnectionState =
  | RuntimeHostConnectionState
  | 'available'
  | 'online-unavailable'
  | 'degraded'
  | 'offline'

export function getRuntimeServerConnectionState(
  details: RuntimeHostDetails | undefined,
  environment?: Pick<PublicKnownRuntimeEnvironment, 'accessSources' | 'accountClaim'>
): RuntimeServerConnectionState {
  if (details?.status === 'loading') {
    return 'checking'
  }
  if (details?.compatibility?.kind === 'blocked') {
    return 'disconnected'
  }
  if (
    details?.status === 'ready' &&
    details.runtimeStatus === null &&
    details.compatibility !== null
  ) {
    return 'connected'
  }
  if (environment && !supportsLocalRuntimeEnvironmentRemoval(environment)) {
    const claim = environment.accountClaim
    if (!claim) {
      return 'checking'
    }
    if (isHiveRuntimeControlPlaneOnline(claim)) {
      return claim.cloudConnectable ? 'available' : 'online-unavailable'
    }
    if (
      claim.presence === 'DEGRADED' ||
      claim.readiness === 'DEGRADED' ||
      claim.readiness === 'STARTING' ||
      claim.readiness === 'RECOVERING'
    ) {
      return 'degraded'
    }
    return 'offline'
  }
  if (!details) {
    return 'checking'
  }
  return runtimeHostConnectionState({
    hasStatusEntry: true,
    status: details.runtimeStatus,
    remoteControl: details.remoteControl,
    transportStatus: details.status === 'ready' ? 'connected' : 'disconnected'
  })
}

export function isRuntimeServerTransportConnected(state: RuntimeServerConnectionState): boolean {
  return isConnectedRuntimeHostState(state)
}

export function getRuntimeServerConnectionLabel(state: RuntimeServerConnectionState): string {
  const labels: Record<RuntimeServerConnectionState, [string, string]> = {
    connected: ['auto.components.settings.RuntimeEnvironmentsPane.serverConnected', 'Connected'],
    available: ['auto.components.settings.RuntimeEnvironmentsPane.serverAvailable', 'Available'],
    'online-unavailable': [
      'auto.components.settings.RuntimeEnvironmentsPane.serverOnline',
      'Online'
    ],
    degraded: ['auto.components.settings.RuntimeEnvironmentsPane.serverDegraded', 'Degraded'],
    offline: ['auto.components.settings.RuntimeEnvironmentsPane.serverOffline', 'Offline'],
    'runtime-unavailable': [
      'auto.components.settings.RuntimeEnvironmentsPane.serverRuntimeUnavailable',
      'HiveCode unavailable'
    ],
    'workspace-window-closed': [
      'auto.components.settings.RuntimeEnvironmentsPane.serverWorkspaceWindowClosed',
      'Workspace window closed'
    ],
    reconnecting: [
      'auto.components.settings.RuntimeEnvironmentsPane.serverReconnecting',
      'Reconnecting'
    ],
    checking: ['auto.components.settings.RuntimeEnvironmentsPane.serverChecking', 'Checking…'],
    disconnected: [
      'auto.components.settings.RuntimeEnvironmentsPane.serverDisconnected',
      'Disconnected'
    ]
  }
  const [key, fallback] = labels[state]
  return translate(key, fallback)
}

export function getRuntimeServerDotClass(state: RuntimeServerConnectionState): string {
  if (state === 'connected' || state === 'available' || state === 'online-unavailable') {
    return 'bg-emerald-500'
  }
  if (state === 'disconnected' || state === 'offline') {
    return 'bg-muted-foreground/40'
  }
  return 'bg-yellow-500'
}

export function getAccountRuntimeConnectionHelp(
  state: RuntimeServerConnectionState
): string | null {
  const help: Partial<Record<RuntimeServerConnectionState, [string, string]>> = {
    available: [
      'auto.components.settings.RuntimeEnvironmentsPane.accountRuntimeAvailable',
      'Online in HiveCloud and ready to connect.'
    ],
    'online-unavailable': [
      'auto.components.settings.RuntimeEnvironmentsPane.accountRuntimeTransportUnavailable',
      'Online in HiveCloud. Cross-device access is unavailable.'
    ],
    degraded: [
      'auto.components.settings.RuntimeEnvironmentsPane.accountRuntimeDegraded',
      'HiveCloud is retrying this Runtime connection.'
    ],
    offline: [
      'auto.components.settings.RuntimeEnvironmentsPane.accountRuntimeOffline',
      'Offline in HiveCloud.'
    ]
  }
  const entry = help[state]
  return entry ? translate(entry[0], entry[1]) : null
}
