import type {
  HiveAccountRuntimeDirectoryEntry,
  HiveAccountRuntimeDirectoryState,
  HiveLocalRuntimeOwnershipState
} from '../../../../shared/hive-runtime-cloud'
import {
  isHiveRuntimeControlPlaneOnline,
  isHiveRuntimeCredentialInvalid,
  isHiveRuntimeCrossDeviceConnectable
} from '../../../../shared/hive-runtime-connectivity'
import { translate } from '@/i18n/i18n'
import { formatUiRelativeTime } from '@/i18n/relative-time-format'

export type HiveAccountRuntimeTone = 'neutral' | 'online' | 'warning' | 'danger'

export type HiveAccountRuntimePresentation = {
  tone: HiveAccountRuntimeTone
  label: string
  description: string
  connectionStatus: string
  lastHeartbeat: string
  remoteAccess: string
  online: boolean
  canClaim: boolean
  canRetry: boolean
}

function runtimeEntry(
  directory: HiveAccountRuntimeDirectoryState,
  ownership: HiveLocalRuntimeOwnershipState
): HiveAccountRuntimeDirectoryEntry | null {
  return (
    directory.items.find((entry) => entry.runtimeRecordId === ownership.runtimeRecordId) ?? null
  )
}

function relativeTimestamp(value: number | null): string {
  if (!value) {
    return translate('auto.components.settings.orcaAccount.notAvailable', 'Not available')
  }
  return formatUiRelativeTime(value - Date.now())
}

function presentation(
  tone: HiveAccountRuntimeTone,
  label: string,
  description: string,
  connectionStatus: string,
  entry: HiveAccountRuntimeDirectoryEntry | null,
  options: Pick<HiveAccountRuntimePresentation, 'online' | 'canClaim' | 'canRetry'>
): HiveAccountRuntimePresentation {
  const cloudConnectable = isHiveRuntimeCrossDeviceConnectable(entry)
  return {
    tone,
    label,
    description,
    connectionStatus,
    lastHeartbeat: relativeTimestamp(entry?.lastHeartbeatAt ?? null),
    remoteAccess:
      options.online && cloudConnectable
        ? translate('auto.components.settings.orcaAccount.remoteAccessEnabled', 'Enabled')
        : entry
          ? translate('auto.components.settings.orcaAccount.remoteAccessUnavailable', 'Unavailable')
          : translate('auto.components.settings.orcaAccount.notAvailable', 'Not available'),
    ...options
  }
}

export function resolveHiveAccountRuntimePresentation(
  directory: HiveAccountRuntimeDirectoryState,
  ownership: HiveLocalRuntimeOwnershipState,
  accountAuthorized = true
): HiveAccountRuntimePresentation {
  const entry = runtimeEntry(directory, ownership)
  const connecting = () =>
    presentation(
      'neutral',
      translate('auto.components.settings.orcaAccount.runtimeConnecting', 'Connecting'),
      translate(
        'auto.components.settings.orcaAccount.runtimeConnectingDescription',
        "Checking this device's HiveCloud connection."
      ),
      translate('auto.components.settings.orcaAccount.runtimeStarting', 'Starting'),
      entry,
      { online: false, canClaim: false, canRetry: false }
    )

  if (!accountAuthorized) {
    return presentation(
      'warning',
      translate('auto.components.settings.orcaAccount.runtimeSignInRequired', 'Sign-in required'),
      translate(
        'auto.components.settings.orcaAccount.runtimeSignInRequiredDescription',
        'Sign in to HiveCloud again before cross-device access can resume.'
      ),
      translate(
        'auto.components.settings.orcaAccount.accountAuthorizationRequired',
        'Authorization required'
      ),
      entry,
      { online: false, canClaim: false, canRetry: false }
    )
  }

  if (directory.status === 'LOADING' || ownership.relation === 'ANALYZING') {
    return connecting()
  }

  if (
    directory.status === 'SIGNED_OUT' ||
    directory.status === 'DISABLED' ||
    ownership.presence === 'DISABLED'
  ) {
    return presentation(
      'neutral',
      translate('auto.components.settings.orcaAccount.runtimeNotEnabled', 'Not enabled'),
      translate(
        'auto.components.settings.orcaAccount.runtimeNotEnabledDescription',
        'Cloud Runtime access is not enabled on this device.'
      ),
      translate('auto.components.settings.orcaAccount.runtimeNotEnabled', 'Not enabled'),
      entry,
      { online: false, canClaim: false, canRetry: false }
    )
  }

  if (directory.status === 'ERROR' || ownership.relation === 'UNVERIFIABLE') {
    return presentation(
      'warning',
      translate(
        'auto.components.settings.orcaAccount.runtimeServiceUnavailable',
        'Service temporarily unavailable'
      ),
      translate(
        'auto.components.settings.orcaAccount.runtimeServiceUnavailableDescription',
        'HiveCloud status cannot be verified. Local work remains available.'
      ),
      translate('auto.components.settings.orcaAccount.runtimeUnverifiable', 'Unavailable'),
      entry,
      { online: false, canClaim: false, canRetry: true }
    )
  }

  if (ownership.relation === 'UNREGISTERED') {
    return presentation(
      'warning',
      translate('auto.components.settings.orcaAccount.runtimeNotLinked', 'Not linked'),
      translate(
        'auto.components.settings.orcaAccount.runtimeUnregisteredDescription',
        'This Runtime is not yet registered with the current account.'
      ),
      translate('auto.components.settings.orcaAccount.runtimeNotLinked', 'Not linked'),
      entry,
      { online: false, canClaim: true, canRetry: false }
    )
  }

  if (ownership.relation === 'PENDING_CLAIM') {
    return presentation(
      'warning',
      translate(
        'auto.components.settings.orcaAccount.runtimeWaitingClaim',
        'Waiting to be claimed'
      ),
      translate(
        'auto.components.settings.orcaAccount.runtimeWaitingClaimDescription',
        'This Runtime is registered but is not yet linked to the current account.'
      ),
      translate('auto.components.settings.orcaAccount.runtimeNotLinked', 'Not linked'),
      entry,
      {
        online: false,
        canClaim: ownership.claimCapabilityAvailable,
        canRetry: !ownership.claimCapabilityAvailable
      }
    )
  }

  if (
    ownership.relation === 'CLAIMED_BY_OTHER' ||
    ownership.relation === 'TRANSFER_PENDING' ||
    ownership.presence === 'FENCED'
  ) {
    return presentation(
      'danger',
      translate('auto.components.settings.orcaAccount.runtimeIsolated', 'Runtime isolated'),
      translate(
        'auto.components.settings.orcaAccount.runtimeIsolatedDescription',
        'This device must be linked again before cross-device access can resume.'
      ),
      translate('auto.components.settings.orcaAccount.runtimeCredentialInvalid', 'Link invalid'),
      entry,
      { online: false, canClaim: false, canRetry: true }
    )
  }

  if (isHiveRuntimeCredentialInvalid(entry)) {
    return presentation(
      'danger',
      translate(
        'auto.components.settings.orcaAccount.runtimeCredentialInvalid',
        'Connection credential invalid'
      ),
      translate(
        'auto.components.settings.orcaAccount.runtimeCredentialInvalidDescription',
        'Link this device again to restore cross-device access.'
      ),
      translate('auto.components.settings.orcaAccount.runtimeCredentialInvalid', 'Link invalid'),
      entry,
      { online: false, canClaim: false, canRetry: true }
    )
  }

  if (entry?.credentialState === 'ROTATING') {
    return presentation(
      'warning',
      translate(
        'auto.components.settings.orcaAccount.runtimeCredentialRotating',
        'Refreshing connection credential'
      ),
      translate(
        'auto.components.settings.orcaAccount.runtimeCredentialRotatingDescription',
        'Cross-device access will resume after the Runtime credential is refreshed.'
      ),
      translate('auto.components.settings.orcaAccount.runtimeStarting', 'Starting'),
      entry,
      { online: false, canClaim: false, canRetry: false }
    )
  }

  if (
    ownership.presence === 'OFFLINE_RETRY' ||
    entry?.presence === 'OFFLINE' ||
    entry?.presence === 'DEGRADED' ||
    entry?.readiness === 'DEGRADED' ||
    entry?.readiness === 'RECOVERING'
  ) {
    return presentation(
      'warning',
      translate('auto.components.settings.orcaAccount.runtimeRetrying', 'Retrying'),
      translate(
        'auto.components.settings.orcaAccount.runtimeRetryingDescription',
        'The Runtime connection was interrupted and HiveCode is retrying.'
      ),
      translate('auto.components.settings.orcaAccount.runtimeInterrupted', 'Interrupted'),
      entry,
      { online: false, canClaim: false, canRetry: true }
    )
  }

  if (ownership.relation === 'CLAIMED_BY_CURRENT' && isHiveRuntimeControlPlaneOnline(entry)) {
    return presentation(
      'online',
      translate('auto.components.settings.orcaAccount.runtimeOnline', 'Online'),
      translate(
        'auto.components.settings.orcaAccount.runtimeConnectedDescription',
        'This device is connected to HiveCloud.'
      ),
      translate('auto.components.settings.orcaAccount.runtimeHealthy', 'Running normally'),
      entry,
      { online: true, canClaim: false, canRetry: false }
    )
  }

  if (
    ownership.presence === 'STOPPED' ||
    entry?.readiness === 'STOPPED' ||
    entry?.readiness === 'ERROR'
  ) {
    return presentation(
      'danger',
      translate(
        'auto.components.settings.orcaAccount.runtimeInterrupted',
        'Connection interrupted'
      ),
      translate(
        'auto.components.settings.orcaAccount.runtimeInterruptedDescription',
        'Cross-device access is unavailable until the Runtime reconnects.'
      ),
      translate('auto.components.settings.orcaAccount.runtimeStopped', 'Stopped'),
      entry,
      { online: false, canClaim: false, canRetry: true }
    )
  }

  return connecting()
}

export function currentDevicePlatformLabel(userAgent: string): string {
  if (/Windows/i.test(userAgent)) {
    return 'Windows'
  }
  if (/Macintosh|Mac OS/i.test(userAgent)) {
    return 'macOS'
  }
  if (/Linux/i.test(userAgent)) {
    return 'Linux'
  }
  return translate('auto.components.settings.orcaAccount.desktopPlatform', 'Desktop')
}
