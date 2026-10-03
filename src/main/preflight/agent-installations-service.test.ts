import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readAgentInstallations } from './agent-installations-service'

const mocks = vi.hoisted(() => ({
  candidates: vi.fn(),
  resolve: vi.fn(),
  real: vi.fn(),
  target: vi.fn(),
  version: vi.fn(),
  guest: vi.fn(),
  wsl: vi.fn(),
  brew: vi.fn(),
  lstat: vi.fn(),
  managed: vi.fn()
}))
vi.mock('node:fs', async (original) => ({ ...(await original<object>()), lstatSync: mocks.lstat }))
vi.mock('../../shared/node-cli-command-resolution', () => ({
  resolveCliCommands: mocks.resolve
}))
vi.mock('../../shared/cli-command-candidates', () => ({
  listCliCommandCandidates: mocks.candidates
}))
vi.mock('../ipc/agent-detection-shell-path', () => ({ hydrateShellPathForAgentDetection: vi.fn() }))
vi.mock('../ipc/preflight-local-env', () => ({
  buildLocalPreflightEnv: () => ({ PATH: '/tools:/other' })
}))
vi.mock('./agent-installation-identity', () => ({
  agentInstallationRealPath: mocks.real,
  sameAgentInstallationPath: (a: string, b: string) => a === b
}))
vi.mock('./agent-upgrade-target', async (original) => ({
  ...(await original<object>()),
  resolveAgentUpgradeTarget: mocks.target
}))
vi.mock('./agent-version-service', () => ({ readAgentVersion: mocks.version }))
vi.mock('./agent-homebrew-target', async (original) => ({
  ...(await original<object>()),
  readHomebrewTargetVersion: mocks.brew
}))
vi.mock('./agent-managed-source', () => ({ readManagedAgentSource: mocks.managed }))
vi.mock('../wsl/wsl-guest-environment', () => ({ getWslGuestEnvironment: mocks.guest }))
vi.mock('../wsl/wsl-runner', () => ({ runWslProcess: mocks.wsl }))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.managed.mockResolvedValue('unknown')
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  mocks.resolve.mockReturnValue(new Map([['codex', '/tools/codex']]))
  mocks.candidates.mockReturnValue(['/tools/codex', '/alias/codex', '/other/codex'])
  mocks.real.mockImplementation((file: string) => (file === '/alias/codex' ? '/tools/codex' : file))
  mocks.target.mockReturnValue({ prefix: '/tools', command: '/tools/codex' })
  mocks.version.mockImplementation(async ({ commandOverride }: { commandOverride: string }) =>
    commandOverride === '/other/codex'
      ? { status: 'error', version: null, reason: 'version-read-failed' }
      : { status: 'ready', version: '1.2.3' }
  )
})

describe('agent installation inventory', () => {
  it('keeps dangling symlinks visible as broken installations', async () => {
    mocks.real.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    mocks.lstat.mockReturnValue({ isSymbolicLink: () => true })
    mocks.version.mockResolvedValue({ status: 'error', version: null })
    const report = await readAgentInstallations({ agent: 'codex' })
    expect(report.installations[0]).toMatchObject({
      path: '/tools/codex',
      health: 'broken',
      canUpgrade: false
    })
  })

  it('does not offer the binary installer for unsupported Homebrew-owned packages', async () => {
    mocks.real.mockReturnValue('/opt/homebrew/Cellar/acli/1.0.0/bin/acli')
    mocks.target.mockReturnValue(null)
    mocks.managed.mockResolvedValue('binary')
    const report = await readAgentInstallations({ agent: 'rovo' })
    expect(report.installations[0]).toMatchObject({ source: 'unknown', canUpgrade: false })
    expect(mocks.managed).not.toHaveBeenCalled()
  })
  it('deduplicates real files, retains broken installs and marks default and active entries', async () => {
    const report = await readAgentInstallations({ agent: 'codex' })
    expect(report.status).toBe('ready')
    expect(report.installations).toHaveLength(2)
    expect(report.installations[0]).toMatchObject({
      source: 'npm',
      isActive: true,
      isDefault: true,
      canUpgrade: true
    })
    expect(report.installations[1]).toMatchObject({
      path: '/other/codex',
      health: 'broken',
      canUpgrade: false
    })
    expect(report.conflict).toBe(true)
    expect(mocks.version).toHaveBeenCalledTimes(2)
  })

  it('distinguishes an explicit HiveCode launch path from the default command', async () => {
    const report = await readAgentInstallations({ agent: 'codex', commandOverride: '/other/codex' })
    expect(report.installations[0]).toMatchObject({
      path: '/other/codex',
      isActive: true,
      isDefault: false
    })
    expect(report.installations[1]).toMatchObject({
      path: '/tools/codex',
      isActive: false,
      isDefault: true
    })
  })

  it('does not call two healthy identical versions a conflict', async () => {
    mocks.version.mockResolvedValue({ status: 'ready', version: '1.2.3' })
    expect((await readAgentInstallations({ agent: 'codex' })).conflict).toBe(false)
  })

  it('keeps unverified source unavailable even when it runs', async () => {
    mocks.target.mockReturnValue(null)
    expect((await readAgentInstallations({ agent: 'codex' })).installations[0]).toMatchObject({
      health: 'ready',
      source: 'unknown',
      canUpgrade: false
    })
  })

  it('does not advertise a Bun installation as self-updating when ownership is unverified', async () => {
    mocks.target.mockReturnValue({ command: '/tools/omp', args: ['update'] })
    const report = await readAgentInstallations({ agent: 'omp' })
    expect(report.installations[0]).toMatchObject({ source: 'unknown', canUpgrade: false })
  })

  it('bounds version probes and reports incomplete inventory', async () => {
    mocks.candidates.mockReturnValue(Array.from({ length: 30 }, (_, i) => `/tools${i}/codex`))
    const report = await readAgentInstallations({ agent: 'codex' })
    expect(report.installations).toHaveLength(12)
    expect(report.truncated).toBe(true)
    expect(mocks.version).toHaveBeenCalledTimes(12)
  })

  it('rejects compound commands and caller-supplied host identity', async () => {
    expect(
      await readAgentInstallations({ agent: 'codex', commandOverride: 'codex; touch other' })
    ).toMatchObject({ status: 'error' })
    const invalidRequest = { agent: 'codex' as const, environmentId: 'other' }
    expect(await readAgentInstallations(invalidRequest)).toMatchObject({ status: 'error' })
    expect(mocks.candidates).not.toHaveBeenCalled()
  })

  it('reads selected WSL guest inventory without probing native candidates', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    mocks.guest.mockResolvedValue({
      path: '/usr/bin',
      home: '/home/dev',
      envBinary: '/usr/bin/env'
    })
    mocks.wsl.mockResolvedValue({
      code: 0,
      timedOut: false,
      environmentResolved: true,
      stdout: [
        '__HIVE_INSTALLATIONS__',
        '/usr/bin/codex',
        '/usr/bin/codex',
        '/usr/bin/codex',
        '/opt/codex.js',
        'npm',
        ''
      ].join('\0')
    })
    const report = await readAgentInstallations({ agent: 'codex', wslDistro: 'Ubuntu' })
    expect(report.installations[0]).toMatchObject({
      path: '/usr/bin/codex',
      realPath: '/opt/codex.js',
      source: 'npm',
      isActive: true
    })
    expect(mocks.wsl).toHaveBeenCalledWith(expect.objectContaining({ distro: 'Ubuntu' }))
    expect(mocks.version).toHaveBeenCalledWith(expect.objectContaining({ wslDistro: 'Ubuntu' }))
    expect(mocks.candidates).not.toHaveBeenCalled()
  })

  it('does not substitute local inventory when WSL cannot be reached', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    mocks.guest.mockResolvedValue(null)
    expect(await readAgentInstallations({ agent: 'codex', wslDistro: 'Offline' })).toMatchObject({
      status: 'error',
      installations: [],
      reason: 'environment-unverifiable'
    })
    expect(mocks.candidates).not.toHaveBeenCalled()
  })
})
