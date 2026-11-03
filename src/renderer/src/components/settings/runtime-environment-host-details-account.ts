import { translate } from '@/i18n/i18n'
import type { RuntimeStatus } from '../../../../shared/runtime-types'
import type { PublicKnownRuntimeEnvironment } from '../../../../shared/runtime-environments'
import type { RuntimeHostDetails } from './runtime-environment-host-details'

type EvaluateHostDetails = (status: RuntimeStatus) => RuntimeHostDetails['compatibility']

export function supportsLocalRuntimeEnvironmentRemoval(
  environment: Pick<PublicKnownRuntimeEnvironment, 'accessSources'>
): boolean {
  return (
    environment.accessSources === undefined || environment.accessSources.includes('local-pairing')
  )
}

export function canConnectRuntimeEnvironment(
  environment: Pick<PublicKnownRuntimeEnvironment, 'accessSources' | 'accountClaim'>
): boolean {
  return (
    supportsLocalRuntimeEnvironmentRemoval(environment) ||
    environment.accountClaim?.cloudConnectable === true
  )
}

export function getRuntimeEnvironmentEndpointDisplay(
  environment: Pick<PublicKnownRuntimeEnvironment, 'accessSources' | 'endpoints'>
): string {
  if (!supportsLocalRuntimeEnvironmentRemoval(environment)) {
    return translate(
      'auto.components.settings.RuntimeEnvironmentsPane.hiveCloudManagedEndpoint',
      'Managed by HiveCloud'
    )
  }
  return (
    environment.endpoints[0]?.endpoint ??
    translate('auto.components.settings.RuntimeEnvironmentsPane.6ef71985da', 'No endpoint')
  )
}

export function resolveRuntimeCloudRenameEnvironment(
  environments: readonly PublicKnownRuntimeEnvironment[],
  environmentId: string | null,
  selectedAccountScopeKey: string | null,
  currentAccountScopeKey: string | null
): PublicKnownRuntimeEnvironment | null {
  if (
    !environmentId ||
    !selectedAccountScopeKey ||
    selectedAccountScopeKey !== currentAccountScopeKey
  ) {
    return null
  }
  return (
    environments.find(
      (environment) =>
        environment.id === environmentId &&
        environment.accountClaim?.cloudDisplayNameVersion != null
    ) ?? null
  )
}

export function getRuntimeEnvironmentInitialDetails(
  environment: Pick<PublicKnownRuntimeEnvironment, 'accessSources' | 'accountClaim'>,
  evaluateHostDetails: EvaluateHostDetails,
  current?: RuntimeHostDetails,
  verifiedStatus?: RuntimeStatus
): RuntimeHostDetails {
  if (verifiedStatus) {
    return {
      status: 'ready',
      runtimeStatus: verifiedStatus,
      remoteControl: verifiedStatus.remoteControl ?? null,
      compatibility: evaluateHostDetails(verifiedStatus),
      error: null
    }
  }
  if (!supportsLocalRuntimeEnvironmentRemoval(environment)) {
    return {
      status: 'error',
      runtimeStatus: null,
      remoteControl: null,
      compatibility: null,
      error: null
    }
  }
  return (
    current ?? {
      status: 'loading',
      runtimeStatus: null,
      remoteControl: null,
      compatibility: null,
      error: null
    }
  )
}

export type RuntimeEnvironmentRemovalPresentation = Readonly<{
  title: string
  description: string
  actionLabel: string
  actionAriaLabel: string
  successMessage: string
}>

export function getRuntimeEnvironmentRemovalPresentation(
  environment: Pick<PublicKnownRuntimeEnvironment, 'accessSources' | 'name'>,
  isActive: boolean
): RuntimeEnvironmentRemovalPresentation | null {
  if (!supportsLocalRuntimeEnvironmentRemoval(environment)) {
    return null
  }
  if (environment.accessSources?.includes('account-claimed') === true) {
    return {
      title: translate(
        'auto.components.settings.RuntimeEnvironmentsPane.removeLocalPairingTitle',
        'Remove Local Pairing'
      ),
      description: isActive
        ? translate(
            'auto.components.settings.RuntimeEnvironmentsPane.removeActiveLocalPairingDescription',
            'Choose another Active Server in Advanced before removing this local pairing. The server remains available through your account.'
          )
        : translate(
            'auto.components.settings.RuntimeEnvironmentsPane.removeLocalPairingDescription',
            'This removes only the local pairing from HiveCode. The server remains available through your account.'
          ),
      actionLabel: translate(
        'auto.components.settings.RuntimeEnvironmentsPane.removeLocalPairingAction',
        'Remove Local Pairing'
      ),
      actionAriaLabel: translate(
        'auto.components.settings.RuntimeEnvironmentsPane.removeLocalPairingAriaLabel',
        'Remove local pairing for {{value0}}',
        { value0: environment.name }
      ),
      successMessage: translate(
        'auto.components.settings.RuntimeEnvironmentsPane.removeLocalPairingSuccess',
        'Removed local pairing for {{value0}}. Account access remains available.',
        { value0: environment.name }
      )
    }
  }
  return {
    title: translate(
      'auto.components.settings.RuntimeEnvironmentsPane.bb90dd6487',
      'Remove Server'
    ),
    description: isActive
      ? translate(
          'auto.components.settings.RuntimeEnvironmentsPane.removeActiveServerDescription',
          'Choose another Active Server in Advanced before removing this server. Existing host sessions are left alone.'
        )
      : translate(
          'auto.components.settings.RuntimeEnvironmentsPane.ed3e3f069d',
          'This removes the saved server from HiveCode. It does not change the active server.'
        ),
    actionLabel: translate('auto.components.settings.RuntimeEnvironmentsPane.d25f0688b1', 'Remove'),
    actionAriaLabel: translate(
      'auto.components.settings.RuntimeEnvironmentsPane.aeb26635d2',
      'Remove {{value0}}',
      { value0: environment.name }
    ),
    successMessage: translate(
      'auto.components.settings.RuntimeEnvironmentsPane.b5b5114cb0',
      'Removed {{value0}}.',
      { value0: environment.name }
    )
  }
}
