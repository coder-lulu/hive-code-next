import { translate } from '@/i18n/i18n'

export function agentBridgeUnavailableMessage(): string {
  return translate(
    'agentsSettings.bridgeUnavailable',
    'The desktop connection is unavailable. Restart HiveCode to load the updated agent tools.'
  )
}

export function agentInstallFailureMessage(
  reason?: string,
  action: 'install' | 'upgrade' = 'install'
): string {
  if (reason === 'bridge-unavailable') {
    return agentBridgeUnavailableMessage()
  }
  const failure =
    action === 'upgrade'
      ? translate('agentsSettings.upgradeFailed', 'Upgrade failed. Check the output and retry.')
      : translate(
          'agentsSettings.installFailed',
          'Installation failed. Check the output and retry.'
        )
  const unverified = translate(
    'agentsSettings.upgradeUnverified',
    'This CLI installation could not be verified for automatic upgrade. Use the upgrade guide.'
  )
  const messages: Record<string, string> = {
    'upgrade-target-changed': translate(
      'agentsSettings.upgradeTargetChanged',
      'This installation changed since it was inspected. Refresh installation details before upgrading.'
    ),
    'install-busy': translate(
      'agentsSettings.installBusy',
      'Another installation or upgrade is running in this environment. Wait for it to finish, then retry.'
    ),
    'node-npm-unavailable': translate(
      'agentsSettings.installNeedsNode',
      'Install Node.js and npm in this environment, then retry.'
    ),
    'install-timeout':
      action === 'upgrade'
        ? translate(
            'agentsSettings.upgradeTimedOut',
            'Upgrade timed out. Check the network connection and retry.'
          )
        : translate(
            'agentsSettings.installTimedOut',
            'Installation timed out. Check the network connection and retry.'
          ),
    'install-provider-unavailable':
      action === 'upgrade'
        ? unverified
        : translate(
            'agentsSettings.installUnsupported',
            'Use the installation guide for this agent.'
          ),
    'wsl-target-unavailable': translate(
      'agentsSettings.installTargetUnavailable',
      'The selected WSL environment is unavailable. Refresh detection and retry.'
    ),
    'environment-unverifiable': translate(
      'agentsSettings.environmentUnavailable',
      'The current environment could not be verified. Check the runtime or WSL connection and refresh detection.'
    ),
    'install-verification-failed':
      action === 'upgrade'
        ? translate(
            'agentsSettings.upgradeVerificationFailed',
            'Upgrade finished, but the agent version could not be verified. Check the output and refresh detection.'
          )
        : translate(
            'agentsSettings.installVerificationFailed',
            'Installation finished, but the agent version could not be verified. Check the output and refresh detection.'
          ),
    'install-failed': failure,
    'upgrade-failed': failure,
    'invalid-install-request': failure,
    'upgrade-installation-unverified': unverified,
    'upgrade-provider-unavailable': unverified,
    'upgrade-target-unverifiable': unverified,
    'upgrade-version-unavailable': translate(
      'agentsSettings.upgradeVersionUnavailable',
      'The latest version could not be verified. Check the connection and retry.'
    ),
    'install-platform-unavailable': translate(
      'agentsSettings.installPlatformUnavailable',
      'This installer does not support the current environment. Use the installation guide.'
    ),
    'installer-runtime-unavailable': translate(
      'agentsSettings.installRuntimeUnavailable',
      'An installation dependency is unavailable in this environment. Follow the installation guide, then retry.'
    )
  }
  const message = reason ? messages[reason] : undefined
  return message ? message : reason?.slice(0, 512) || failure
}
