import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CliInstallStatus } from '../../shared/cli-install-types'
import { CliInstallLocation } from './cli-install-location'
import type { CliInstallerOptions } from './cli-installer-contracts'

class CliInstallLocationHarness extends CliInstallLocation {
  getCommandName(): string {
    return this.commandName
  }

  getCommandPath(): string | null {
    return this.resolveCommandPath()
  }

  protected async inspectSymlink(
    _commandPath: string,
    _launcherPath: string
  ): Promise<CliInstallStatus> {
    throw new Error('not used by this location test')
  }

  protected isLinuxAppImage(): boolean {
    return false
  }
}

function createLocation(options: CliInstallerOptions): CliInstallLocationHarness {
  return new CliInstallLocationHarness({
    userDataPath: 'C:\\HiveCode\\user-data',
    resourcesPath: 'C:\\HiveCode\\resources',
    execPath: 'C:\\HiveCode\\HiveCode.exe',
    appPath: 'C:\\HiveCode\\app',
    homePath: 'C:\\Users\\alice',
    localAppDataPath: 'C:\\Users\\alice\\AppData\\Local',
    processPathEnv: '',
    ...options
  })
}

describe('CliInstallLocation product command', () => {
  it.each<NodeJS.Platform>(['darwin', 'linux', 'win32'])(
    'uses hive as the packaged command on %s',
    (platform) => {
      const location = createLocation({
        platform,
        isPackaged: true,
        defaultMacCommandPath: join(process.cwd(), '.missing-hivecode-cli-location-test', 'hive')
      })

      expect(location.getCommandName()).toBe('hive')
      expect(basename(location.getCommandPath() ?? '', '.exe')).toBe('hive')
    }
  )

  it('keeps the isolated development command and Windows compatibility directory', () => {
    const location = createLocation({ platform: 'win32', isPackaged: false })

    expect(location.getCommandName()).toBe('orca-dev')
    expect(location.getCommandPath()).toBe(
      join('C:\\Users\\alice\\AppData\\Local', 'Programs', 'Orca Dev', 'bin', 'orca-dev.cmd')
    )
  })

  it('honors the legacy install-path environment override while reporting the primary command', () => {
    const previousOverride = process.env.ORCA_CLI_INSTALL_PATH
    process.env.ORCA_CLI_INSTALL_PATH = '/home/alice/.local/bin/orca-ide'
    try {
      const location = createLocation({ platform: 'linux', isPackaged: true })

      expect(location.getCommandName()).toBe('hive')
      expect(location.getCommandPath()).toBe('/home/alice/.local/bin/orca-ide')
    } finally {
      if (previousOverride === undefined) {
        delete process.env.ORCA_CLI_INSTALL_PATH
      } else {
        process.env.ORCA_CLI_INSTALL_PATH = previousOverride
      }
    }
  })
})
