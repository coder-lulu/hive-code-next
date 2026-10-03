import { beforeEach, describe, expect, it, vi } from 'vitest'
import { homebrewTargetFromPath, readHomebrewTargetVersion } from './agent-homebrew-target'
import { upgradeHomebrewAgent } from './agent-homebrew-upgrade'

const mocks = vi.hoisted(() => ({ run: vi.fn(), version: vi.fn(), guard: vi.fn() }))
vi.mock('../../shared/child-process/run-process', () => ({ runProcess: mocks.run }))
vi.mock('./agent-version-service', () => ({ readAgentVersion: mocks.version }))
vi.mock('./agent-installation-identity', () => ({ assertReviewedAgentTarget: mocks.guard }))
const target = {
  program: '/opt/homebrew/bin/brew',
  kind: 'cask' as const,
  packageName: 'codex',
  installedVersion: '1.0.0'
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.version
    .mockResolvedValueOnce({ status: 'ready', version: '1.0.0' })
    .mockResolvedValue({ status: 'ready', version: '2.0.0' })
  mocks.run.mockImplementation(async ({ args }: { args: string[] }) => ({
    code: 0,
    timedOut: false,
    stderr: '',
    stdout:
      args[0] === 'info'
        ? JSON.stringify({ casks: [{ token: 'codex', installed: '1.0.0', version: '2.0.0' }] })
        : ''
  }))
})

describe('Homebrew agent ownership and upgrade', () => {
  it.each([
    ['/opt/homebrew/Caskroom/codex/1.0.0/bin/codex', 'cask', '/opt/homebrew/bin/brew'],
    ['/usr/local/Cellar/codex/1.0.0/bin/codex', 'formula', '/usr/local/bin/brew'],
    [
      '/home/linuxbrew/.linuxbrew/Cellar/codex/1.0.0/bin/codex',
      'formula',
      '/home/linuxbrew/.linuxbrew/bin/brew'
    ]
  ])('recognizes managed paths without confusing formula and cask: %s', (file, kind, program) => {
    expect(homebrewTargetFromPath('codex', file)).toMatchObject({
      kind,
      program,
      packageName: 'codex'
    })
  })
  it('rejects unrelated packages and npm installations in the Homebrew prefix', () => {
    expect(homebrewTargetFromPath('codex', '/opt/homebrew/Cellar/other/1.0.0/bin/codex')).toBeNull()
    expect(
      homebrewTargetFromPath('codex', '/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js')
    ).toBeNull()
  })
  it('requires matching installed metadata, not just a path that resembles Homebrew', async () => {
    mocks.run.mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({ casks: [{ token: 'codex', installed: null, version: '2.0.0' }] })
    })
    expect(await readHomebrewTargetVersion(target, {})).toBeNull()
  })
  it('upgrades only the named cask and verifies the same command against the brew version', async () => {
    const result = await upgradeHomebrewAgent(
      { agent: 'codex', action: 'upgrade' },
      '/opt/homebrew/bin/codex',
      target,
      {}
    )
    expect(result).toMatchObject({
      status: 'installed',
      previousVersion: '1.0.0',
      version: '2.0.0'
    })
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({ program: target.program, args: ['upgrade', '--cask', 'codex'] })
    )
    expect(mocks.version.mock.calls[0]).toEqual(mocks.version.mock.calls[1])
  })
  it('refuses a stale target before the package manager mutates files', async () => {
    mocks.guard.mockImplementation(() => {
      throw new Error('upgrade-target-changed')
    })
    await expect(
      upgradeHomebrewAgent({ agent: 'codex' }, '/opt/homebrew/bin/codex', target, {})
    ).rejects.toThrow('upgrade-target-changed')
    expect(mocks.run.mock.calls.some(([spec]) => spec.args[0] === 'upgrade')).toBe(false)
  })
  it('lets brew refresh stale metadata even when the cached latest version matches', async () => {
    mocks.run.mockImplementation(async ({ args }: { args: string[] }) => ({
      code: 0,
      stdout:
        args[0] === 'info'
          ? JSON.stringify({ casks: [{ token: 'codex', installed: '1.0.0', version: '1.0.0' }] })
          : ''
    }))
    const result = await upgradeHomebrewAgent(
      { agent: 'codex' },
      '/opt/homebrew/bin/codex',
      target,
      {}
    )
    expect(result).toMatchObject({ status: 'installed', version: '2.0.0' })
    expect(mocks.run.mock.calls.some(([spec]) => spec.args[0] === 'upgrade')).toBe(true)
  })
  it('does not report success when brew exits zero but the old version still runs', async () => {
    mocks.version.mockReset().mockResolvedValue({ status: 'ready', version: '1.0.0' })
    expect(
      await upgradeHomebrewAgent({ agent: 'codex' }, '/opt/homebrew/bin/codex', target, {})
    ).toMatchObject({
      status: 'error',
      reason: 'install-verification-failed'
    })
  })
})
