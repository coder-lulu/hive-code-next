import { hivecodeProductConfig } from './generated/product-config'

export function getHiveCodeCliCommandNameForPlatform(platform: NodeJS.Platform): string {
  const commandName = hivecodeProductConfig.cli.primary
  if (platform === 'win32') {
    return `${commandName}.cmd`
  }
  return commandName
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

/** @deprecated Use getHiveCodeCliCommandNameForPlatform for new call sites. */
export function getOrcaCliCommandNameForPlatform(platform: NodeJS.Platform): string {
  if (platform === 'linux') {
    return 'orca-ide'
  }
  if (platform === 'win32') {
    return 'orca.cmd'
  }
  return 'orca'
}
