import { join } from 'node:path'
import { hivecodeProductConfig } from '../../shared/generated/product-config'

// Keep the install-location contract aligned with the product-owned CLI name.
export const LINUX_CLI_COMMAND_NAME = hivecodeProductConfig.cli.primary

/** Absolute path of the CLI launcher this app ships in its own resources bundle.
 *  Lives apart from cli-installer so callers that only need the path (PTY env
 *  assembly) don't pull in the installer's `electron` dependency. */
export function getBundledLauncherPath(
  platform: NodeJS.Platform,
  resourcesPath: string
): string | null {
  const commandName = hivecodeProductConfig.cli.primary
  if (platform === 'darwin') {
    return join(resourcesPath, 'bin', commandName)
  }
  if (platform === 'linux') {
    return join(resourcesPath, 'bin', commandName)
  }
  if (platform === 'win32') {
    return join(resourcesPath, 'bin', `${commandName}.exe`)
  }
  return null
}
