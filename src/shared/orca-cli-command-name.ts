import { getAppEnvironment, hasAppEnvironment } from './app-environment'
import { hivecodeProductConfig } from './generated/product-config'

export function getHiveCodeCliCommandNameForPlatform(platform: NodeJS.Platform): string {
  const commandName = hivecodeProductConfig.cli.primary
  return platform === 'win32' ? `${commandName}.cmd` : commandName
}

export function getCompatibilityCliCommandNamesForPlatform(platform: NodeJS.Platform): string[] {
  return hivecodeProductConfig.cli.aliases
    .filter((commandName) => platform !== 'linux' || commandName !== 'orca')
    .map((commandName) => (platform === 'win32' ? `${commandName}.cmd` : commandName))
}

export function getGlobalCliCommandNamesForPlatform(platform: NodeJS.Platform): string[] {
  return [
    getHiveCodeCliCommandNameForPlatform(platform),
    ...getCompatibilityCliCommandNamesForPlatform(platform)
  ]
}

export function getOrcaCliCommandNameForPlatform(platform: NodeJS.Platform): string {
  if (platform === 'linux') {
    return 'orca-ide'
  }
  if (platform === 'win32') {
    return 'orca.cmd'
  }
  return 'orca'
}

/** The GNOME-conflict `orca-ide` rename is desktop-only: SSH relays and headless Orca servers put plain `orca` on PATH. */
export function skipsLinuxOrcaCliRename(isRemote: boolean | undefined): boolean {
  if (isRemote) {
    return true
  }
  // Only a headless server publishes its own launcher; Windows ones (WSL launches) keep the rename.
  const launcher = hasAppEnvironment() ? getAppEnvironment().getCliLauncherPath?.() : null
  return launcher?.endsWith('/orca') ?? false
}
