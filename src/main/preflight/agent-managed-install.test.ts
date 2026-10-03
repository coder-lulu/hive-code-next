import path from 'node:path'
import type * as AgentUpgradeTargetModule from './agent-upgrade-target'
import type * as NodeFs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installManagedAgent } from './agent-managed-install'
import {
  AGENT_INSTALL_PROVIDERS,
  type AgentInstallProvider
} from '../../shared/agent-install-providers'

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  runWsl: vi.fn(),
  resolveCommands: vi.fn(),
  buildEnv: vi.fn(),
  hydrateDetection: vi.fn(),
  hydratePath: vi.fn(),
  mergePath: vi.fn(),
  invalidateWindowsPath: vi.fn(),
  guest: vi.fn(),
  invalidateGuest: vi.fn(),
  current: vi.fn(),
  latest: vi.fn(),
  download: vi.fn(),
  mkdirTemp: vi.fn(),
  writeFile: vi.fn(),
  remove: vi.fn(),
  binary: vi.fn(),
  bunOwnership: vi.fn(),
  guard: vi.fn()
}))
vi.mock('../../shared/child-process/run-process', () => ({ runProcess: mocks.run }))
vi.mock('../../shared/node-cli-command-resolution', () => ({
  resolveCliCommands: mocks.resolveCommands,
  withCliRuntimeOnPath: (_program: string, env: NodeJS.ProcessEnv) => env
}))
vi.mock('../ipc/agent-detection-shell-path', () => ({
  hydrateShellPathForAgentDetection: mocks.hydrateDetection
}))
vi.mock('../ipc/preflight-local-env', () => ({ buildLocalPreflightEnv: mocks.buildEnv }))
vi.mock('../startup/hydrate-shell-path', () => ({
  hydrateShellPath: mocks.hydratePath,
  mergePathSegments: mocks.mergePath
}))
vi.mock('../pty/windows-environment-path', () => ({
  invalidatePersistedWindowsPathCache: mocks.invalidateWindowsPath
}))
vi.mock('../wsl/wsl-guest-environment', () => ({
  getWslGuestEnvironment: mocks.guest,
  invalidateWslGuestEnvironment: mocks.invalidateGuest
}))
vi.mock('../wsl/wsl-runner', () => ({ runWslProcess: mocks.runWsl }))
vi.mock('./agent-version-service', () => ({
  readAgentVersion: mocks.current,
  readLatestAgentVersion: mocks.latest
}))
vi.mock('./agent-installer-download', () => ({ downloadAgentInstaller: mocks.download }))
vi.mock('./agent-binary-install', () => ({ installAgentBinary: mocks.binary }))
vi.mock('./agent-installation-identity', () => ({ assertReviewedAgentTarget: mocks.guard }))
vi.mock('./agent-upgrade-target', async (importOriginal) => ({
  ...(await importOriginal<typeof AgentUpgradeTargetModule>()),
  verifyAgentBunOwnership: mocks.bunOwnership
}))
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeFs>()),
  mkdtempSync: mocks.mkdirTemp,
  writeFileSync: mocks.writeFile,
  rmSync: mocks.remove
}))

const bunProvider = AGENT_INSTALL_PROVIDERS.omp as AgentInstallProvider
const uvProvider = AGENT_INSTALL_PROVIDERS.aider as AgentInstallProvider
const hermesProvider = AGENT_INSTALL_PROVIDERS.hermes as AgentInstallProvider
const success = { code: 0, stdout: '', stderr: '', timedOut: false }
const installerDirectory = path.join(
  process.cwd(),
  'logs',
  'agent-lifecycle-registry',
  'managed-tests',
  'tmp',
  'installer'
)
const guestEnvironment = {
  path: '/home/dev/.local/bin:/usr/bin',
  home: '/home/dev',
  envBinary: '/usr/bin/env'
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) {
    mock.mockReset()
  }
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  mocks.buildEnv.mockReturnValue({ Path: 'C:\\tools' })
  mocks.hydrateDetection.mockResolvedValue(undefined)
  mocks.hydratePath.mockResolvedValue({ ok: true, segments: ['C:\\fresh'] })
  mocks.current.mockResolvedValue({ status: 'ready', version: '2.0.0' })
  mocks.latest.mockResolvedValue({ status: 'ready', version: '2.0.0' })
  mocks.bunOwnership.mockResolvedValue(true)
  mocks.download.mockResolvedValue(Buffer.from('# official installer fixture'))
  mocks.mkdirTemp.mockReturnValue(installerDirectory)
  mocks.guest.mockResolvedValue(guestEnvironment)
  mocks.resolveCommands.mockImplementation(
    (commands: string[]) =>
      new Map(
        commands.map((command) => [
          command,
          command === 'omp' || command === 'aider'
            ? `C:\\managed\\${command}.exe`
            : `C:\\tools\\${command}.exe`
        ])
      )
  )
  mocks.run.mockImplementation(async ({ args }: { args: string[] }) => ({
    ...success,
    stdout:
      args[0] === '--version'
        ? '1.3.14\n'
        : args[0] === 'pm' || (args[0] === 'tool' && args[1] === 'dir')
          ? 'C:\\managed\n'
          : ''
  }))
  mocks.runWsl.mockResolvedValue({
    ...success,
    environmentResolved: true,
    stdout: '\n__HIVE_AGENT_COMMAND__/home/dev/.local/bin/omp\n'
  })
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('managed package manager selection', () => {
  it('rechecks the reviewed target after awaiting package-manager discovery', async () => {
    mocks.current.mockResolvedValueOnce({ status: 'ready', version: '1.0.0' })
    mocks.run.mockImplementation(async () => {
      mocks.guard.mockImplementation(() => {
        throw new Error('upgrade-target-changed')
      })
      return { ...success, stdout: 'C:\\managed\n' }
    })
    await expect(
      installManagedAgent(
        { agent: 'aider', action: 'upgrade', expectedRealPath: 'C:\\reviewed\\aider.exe' },
        uvProvider
      )
    ).rejects.toThrow('upgrade-target-changed')
    expect(mocks.run.mock.calls.some(([spec]) => spec.args[1] === 'upgrade')).toBe(false)
  })
  it('installs OMP using Bun and the selected registry without resolving or running npm', async () => {
    expect(await installManagedAgent({ agent: 'omp', registry: 'china' }, bunProvider)).toEqual({
      status: 'installed',
      version: '2.0.0'
    })
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({
        program: 'C:\\tools\\bun.exe',
        args: [
          'add',
          '--global',
          '@oh-my-pi/pi-coding-agent@latest',
          '--registry',
          'https://registry.npmmirror.com'
        ],
        terminationBarrier: true,
        timeoutMs: 120000
      })
    )
    expect(mocks.run.mock.calls.map(([spec]) => spec.program)).toEqual([
      'C:\\tools\\bun.exe',
      'C:\\tools\\bun.exe',
      'C:\\tools\\bun.exe'
    ])
    expect(mocks.resolveCommands.mock.calls.flatMap(([commands]) => commands)).not.toContain('npm')
    expect(mocks.mergePath).toHaveBeenCalledWith(['C:\\managed'])
  })

  it.each([
    { ...success, stdout: '1.3.13\n' },
    { ...success, stdout: 'unknown\n' },
    { ...success, stdout: '1.3.14\n', timedOut: true },
    { ...success, code: 1, stdout: '1.3.14\n' }
  ])('rejects old or unverifiable Bun before package installation', async (runtime) => {
    mocks.run.mockResolvedValue(runtime)
    expect(await installManagedAgent({ agent: 'omp' }, bunProvider)).toMatchObject({
      status: 'error',
      reason: 'bun-unavailable'
    })
    expect(mocks.run).toHaveBeenCalledTimes(1)
    expect(mocks.current).not.toHaveBeenCalled()
  })

  it('reports missing uv without substituting npm or another installer', async () => {
    mocks.resolveCommands.mockImplementation(
      (commands: string[]) =>
        new Map(
          commands
            .filter((command) => command !== 'uv')
            .map((command) => [command, `C:\\tools\\${command}.exe`])
        )
    )
    expect(await installManagedAgent({ agent: 'aider' }, uvProvider)).toMatchObject({
      status: 'error',
      reason: 'uv-unavailable'
    })
    expect(mocks.run).not.toHaveBeenCalled()
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('does not claim an upgrade when Bun succeeds but the installed CLI stays below the selected latest', async () => {
    mocks.current.mockResolvedValue({ status: 'ready', version: '1.0.0' })
    expect(
      await installManagedAgent({ agent: 'omp', action: 'upgrade' }, bunProvider)
    ).toMatchObject({ status: 'error', reason: 'install-verification-failed' })
    expect(mocks.run.mock.calls.some(([spec]) => spec.args[0] === 'add')).toBe(true)
  })

  it('does not overwrite an unproven standalone CLI located inside the Bun global bin', async () => {
    mocks.current.mockResolvedValue({ status: 'ready', version: '1.0.0' })
    mocks.bunOwnership.mockResolvedValue(false)
    expect(
      await installManagedAgent({ agent: 'omp', action: 'upgrade' }, bunProvider)
    ).toMatchObject({ reason: 'upgrade-provider-unavailable' })
    expect(mocks.run.mock.calls.some(([spec]) => spec.args[0] === 'add')).toBe(false)
  })
})

describe('fixed official scripts and environment refresh', () => {
  it('uses the official Windows script, RemoteSigned, cleanup, and a newly rebuilt PATH after force hydration', async () => {
    mocks.buildEnv
      .mockReturnValueOnce({ Path: 'C:\\stale' })
      .mockReturnValueOnce({ PATH: 'C:\\fresh' })
    mocks.resolveCommands.mockImplementation(
      (commands: string[], options: { pathEnv?: string }) =>
        new Map(
          commands.flatMap((command) =>
            command === 'hermes'
              ? options.pathEnv === 'C:\\fresh'
                ? [[command, 'C:\\fresh\\hermes.exe']]
                : []
              : [[command, 'C:\\tools\\powershell.exe']]
          )
        )
    )
    expect(await installManagedAgent({ agent: 'hermes' }, hermesProvider)).toMatchObject({
      status: 'installed',
      version: '2.0.0'
    })
    expect(mocks.download).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1'
    )
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({
        program: 'C:\\tools\\powershell.exe',
        args: [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'RemoteSigned',
          '-File',
          path.join(installerDirectory, 'install.ps1'),
          '-NonInteractive'
        ],
        terminationBarrier: true
      })
    )
    expect(mocks.remove).toHaveBeenCalledWith(installerDirectory, { recursive: true, force: true })
    expect(mocks.invalidateWindowsPath).toHaveBeenCalledTimes(1)
    expect(mocks.hydratePath).toHaveBeenCalledWith({ force: true })
    expect(mocks.invalidateWindowsPath.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.hydratePath.mock.invocationCallOrder[0]
    )
    expect(mocks.hydratePath.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.buildEnv.mock.invocationCallOrder[1]
    )
    expect(mocks.current).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'hermes', commandOverride: 'C:\\fresh\\hermes.exe' })
    )
  })

  it('cleans up the downloaded script when the interpreter spawn fails', async () => {
    mocks.run.mockRejectedValue(new Error('spawn failed'))
    expect(await installManagedAgent({ agent: 'hermes' }, hermesProvider)).toMatchObject({
      status: 'error'
    })
    expect(mocks.remove).toHaveBeenCalledWith(installerDirectory, { recursive: true, force: true })
    expect(mocks.current).not.toHaveBeenCalled()
  })

  it('reports script timeout even when the runner reports exit code zero', async () => {
    mocks.run.mockResolvedValue({ ...success, timedOut: true })
    expect(await installManagedAgent({ agent: 'hermes' }, hermesProvider)).toMatchObject({
      status: 'error',
      reason: 'install-timeout'
    })
    expect(mocks.current).not.toHaveBeenCalled()
  })

  it('does not claim an upgrade when an updater exits zero but no version improvement can be verified', async () => {
    mocks.current.mockResolvedValue({ status: 'ready', version: '1.0.0' })
    mocks.latest.mockResolvedValue({ status: 'unsupported', version: null })
    const cursorProvider = AGENT_INSTALL_PROVIDERS.cursor as AgentInstallProvider
    expect(
      await installManagedAgent({ agent: 'cursor', action: 'upgrade' }, cursorProvider)
    ).toMatchObject({ status: 'error', reason: 'install-verification-failed' })
  })
})

describe('WSL managed installation host boundary', () => {
  it('never falls back to the host when the selected guest environment is unavailable', async () => {
    mocks.guest.mockResolvedValue(null)
    expect(
      await installManagedAgent({ agent: 'omp', wslDistro: 'Ubuntu' }, bunProvider)
    ).toMatchObject({ status: 'error', reason: 'environment-unverifiable' })
    expect(mocks.run).not.toHaveBeenCalled()
    expect(mocks.runWsl).not.toHaveBeenCalled()
    expect(mocks.resolveCommands).not.toHaveBeenCalled()
    expect(mocks.hydrateDetection).not.toHaveBeenCalled()
  })

  it('executes the Bun install only inside the selected guest with registry and path guards', async () => {
    expect(
      await installManagedAgent(
        { agent: 'omp', wslDistro: 'Ubuntu', registry: 'china' },
        bunProvider
      )
    ).toMatchObject({ status: 'installed' })
    const spec = mocks.runWsl.mock.calls[0][0]
    expect(spec).toMatchObject({ distro: 'Ubuntu', loginPath: 'none', timeoutMs: 120000 })
    expect(spec.script).toContain(
      "'@oh-my-pi/pi-coding-agent@latest' '--registry' 'https://registry.npmmirror.com'"
    )
    expect(spec.script).toContain('OMP requires Bun 1.3.14 or later')
    expect(spec.script).toContain('drvfs')
    expect(mocks.run).not.toHaveBeenCalled()
    expect(mocks.current).toHaveBeenCalledWith({
      agent: 'omp',
      wslDistro: 'Ubuntu',
      commandOverride: '/home/dev/.local/bin/omp'
    })
  })

  it('invalidates and re-reads the guest environment after successful official script installation', async () => {
    mocks.guest
      .mockResolvedValueOnce(guestEnvironment)
      .mockResolvedValueOnce({ ...guestEnvironment, path: '/opt/hermes/bin:/usr/bin' })
    mocks.runWsl
      .mockResolvedValueOnce({ ...success, environmentResolved: true })
      .mockResolvedValueOnce({
        ...success,
        environmentResolved: true,
        stdout: '/opt/hermes/bin/hermes'
      })
    expect(
      await installManagedAgent({ agent: 'hermes', wslDistro: 'Ubuntu' }, hermesProvider)
    ).toMatchObject({ status: 'installed' })
    expect(mocks.invalidateGuest).toHaveBeenCalledWith('Ubuntu')
    expect(mocks.guest).toHaveBeenCalledTimes(2)
    expect(mocks.invalidateGuest.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.guest.mock.invocationCallOrder[1]
    )
    expect(mocks.runWsl.mock.calls[1][0].script).toContain("PATH='/opt/hermes/bin:/usr/bin'")
    expect(mocks.current).toHaveBeenCalledWith({
      agent: 'hermes',
      wslDistro: 'Ubuntu',
      commandOverride: '/opt/hermes/bin/hermes'
    })
    expect(mocks.run).not.toHaveBeenCalled()
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.invalidateWindowsPath).not.toHaveBeenCalled()
  })

  it.each([124, 137])(
    'reports guest timeout code %i and preserves the host boundary',
    async (code) => {
      mocks.runWsl.mockResolvedValue({ ...success, code, environmentResolved: true })
      expect(
        await installManagedAgent({ agent: 'omp', wslDistro: 'Ubuntu' }, bunProvider)
      ).toMatchObject({ status: 'error', reason: 'install-timeout' })
      expect(mocks.run).not.toHaveBeenCalled()
      expect(mocks.current).not.toHaveBeenCalled()
    }
  )
})
