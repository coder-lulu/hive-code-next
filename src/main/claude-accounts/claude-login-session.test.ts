import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as NodeFs from 'node:fs'
import type { CapturedClaudeAuth } from './claude-auth-capture'
import type { WslResult, WslSpec } from '../wsl/wsl-runner'
import { runClaudeLoginSession } from './claude-login-session'

const mocks = vi.hoisted(() => ({
  mkdtempSync: vi.fn(),
  realpathSync: vi.fn(),
  rmSync: vi.fn(),
  readLegacy: vi.fn<() => Promise<string | null>>(),
  deleteKeychain: vi.fn<(configDir?: string) => Promise<void>>(),
  writeLegacy: vi.fn<(credentials: string) => Promise<void>>(),
  runWslProcess: vi.fn<(spec: WslSpec) => Promise<WslResult>>()
}))

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeFs>()),
  mkdtempSync: mocks.mkdtempSync,
  realpathSync: mocks.realpathSync,
  rmSync: mocks.rmSync
}))
vi.mock('./keychain', () => ({
  readActiveClaudeKeychainCredentials: mocks.readLegacy,
  deleteActiveClaudeKeychainCredentialsStrict: mocks.deleteKeychain,
  writeActiveClaudeKeychainCredentials: mocks.writeLegacy
}))
vi.mock('../wsl', () => ({
  toWindowsWslPath: (linuxPath: string, distro: string) => `${distro}:${linuxPath}`
}))
vi.mock('../wsl/wsl-runner', () => ({ runWslProcess: mocks.runWslProcess }))

const hostLocation = {
  managedAuthPath: 'mock-managed-auth',
  managedAuthRuntime: 'host' as const,
  wslDistro: null,
  wslLinuxAuthPath: null
}
const captured: CapturedClaudeAuth = {
  credentialsJson: '{"mock":true}',
  oauthAccount: {},
  identity: { email: 'mock@example.test', organizationUuid: null, organizationName: null }
}
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

function dependencies() {
  let currentCancel: (() => boolean) | null = null
  return {
    runCommand: vi
      .fn<Parameters<typeof runClaudeLoginSession>[1]['runCommand']>()
      .mockResolvedValue('mock-status'),
    capture: vi
      .fn<Parameters<typeof runClaudeLoginSession>[1]['capture']>()
      .mockResolvedValue(captured),
    setCancel: vi.fn((cancel: (() => boolean) | null) => {
      currentCancel = cancel
    }),
    currentCancel: () => currentCancel
  }
}

describe('Claude login allocated-temp cleanup', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
    mocks.mkdtempSync.mockReturnValue('mock-allocated-temp')
    mocks.realpathSync.mockReturnValue('mock-canonical-temp')
    mocks.readLegacy.mockResolvedValue('previous-legacy-auth')
    mocks.deleteKeychain.mockResolvedValue()
    mocks.writeLegacy.mockResolvedValue()
  })

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
  })

  it('releases temp and cancel on failed snapshot without mutating unknown keychain auth', async () => {
    const failure = new Error('keychain snapshot unavailable')
    mocks.readLegacy.mockRejectedValue(failure)
    const deps = dependencies()

    await expect(runClaudeLoginSession(hostLocation, deps)).rejects.toBe(failure)

    expect(mocks.rmSync).toHaveBeenCalledWith('mock-canonical-temp', {
      recursive: true,
      force: true
    })
    expect(deps.currentCancel()).toBeNull()
    expect(deps.setCancel).toHaveBeenLastCalledWith(null)
    expect(deps.runCommand).not.toHaveBeenCalled()
    expect(deps.capture).not.toHaveBeenCalled()
    expect(mocks.deleteKeychain).not.toHaveBeenCalled()
    expect(mocks.writeLegacy).not.toHaveBeenCalled()
  })

  it.each(['login', 'capture'] as const)(
    'preserves the %s failure over host temp removal failure',
    async (phase) => {
      const failure = new Error(`${phase} failed first`)
      const cleanupFailure = new Error('temp removal failed second')
      const deps = dependencies()
      if (phase === 'login') {
        deps.runCommand.mockRejectedValueOnce(failure)
      } else {
        deps.capture.mockRejectedValueOnce(failure)
      }
      mocks.rmSync.mockImplementation(() => {
        throw cleanupFailure
      })

      await expect(runClaudeLoginSession(hostLocation, deps)).rejects.toBe(failure)

      expect(mocks.deleteKeychain).toHaveBeenCalledWith('mock-canonical-temp')
      expect(mocks.writeLegacy).toHaveBeenCalledWith('previous-legacy-auth')
      expect(mocks.rmSync).toHaveBeenCalledOnce()
      expect(deps.currentCancel()).toBeNull()
      expect(deps.setCancel).toHaveBeenLastCalledWith(null)
    }
  )

  it('reports host removal failure after successful capture and clears cancellation', async () => {
    const failure = new Error('host cleanup failed')
    const deps = dependencies()
    mocks.rmSync.mockImplementation(() => {
      throw failure
    })

    await expect(runClaudeLoginSession(hostLocation, deps)).rejects.toBe(failure)

    expect(deps.capture).toHaveBeenCalledWith(
      'mock-canonical-temp',
      'mock-status',
      'previous-legacy-auth'
    )
    expect(deps.currentCancel()).toBeNull()
    expect(deps.setCancel).toHaveBeenLastCalledWith(null)
  })

  it.each(['previous-legacy-auth', null])(
    'preserves normal scoped cleanup and restores snapshot %s',
    async (snapshot) => {
      mocks.readLegacy.mockResolvedValue(snapshot)
      const deps = dependencies()

      await expect(runClaudeLoginSession(hostLocation, deps)).resolves.toBe(captured)

      expect(mocks.deleteKeychain).toHaveBeenNthCalledWith(1, 'mock-canonical-temp')
      if (snapshot) {
        expect(mocks.writeLegacy).toHaveBeenCalledWith(snapshot)
        expect(mocks.deleteKeychain).toHaveBeenCalledOnce()
      } else {
        expect(mocks.deleteKeychain).toHaveBeenNthCalledWith(2)
        expect(mocks.writeLegacy).not.toHaveBeenCalled()
      }
      expect(deps.runCommand.mock.calls[0]).toEqual([
        ['auth', 'login', '--claudeai'],
        { windowsPath: 'mock-canonical-temp', linuxPath: null, wslDistro: null },
        180_000,
        { signal: expect.any(AbortSignal), keepStdinOpen: true }
      ])
      expect(deps.runCommand.mock.calls[1][2]).toBe(20_000)
      expect(deps.runCommand.mock.calls[1][3]).toEqual({ allowFailure: true })
      expect(deps.currentCancel()).toBeNull()
    }
  )

  it('awaits WSL temp cleanup after failed snapshot before settling and clearing cancel', async () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    const failure = new Error('snapshot failed')
    mocks.readLegacy.mockRejectedValue(failure)
    const result: WslResult = {
      stdout: '/mock/wsl-temp',
      stderr: '',
      code: 0,
      timedOut: false,
      environmentResolved: false
    }
    let finishCleanup!: (value: WslResult) => void
    mocks.runWslProcess.mockResolvedValueOnce(result).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishCleanup = resolve
        })
    )
    const deps = dependencies()
    let settled = false
    const complete = runClaudeLoginSession(
      {
        managedAuthPath: 'mock-wsl-managed',
        managedAuthRuntime: 'wsl',
        wslDistro: 'Ubuntu',
        wslLinuxAuthPath: '/mock/managed'
      },
      deps
    ).then(
      () => {
        settled = true
        return null
      },
      (error: unknown) => {
        settled = true
        return error
      }
    )
    await vi.waitFor(() => expect(mocks.runWslProcess).toHaveBeenCalledTimes(2))
    expect(settled).toBe(false)
    expect(mocks.runWslProcess.mock.calls[1][0]).toEqual({
      distro: 'Ubuntu',
      loginPath: 'none',
      program: 'rm',
      args: ['-rf', '--', '/mock/wsl-temp'],
      timeoutMs: 5000
    })
    finishCleanup(result)
    expect(await complete).toBe(failure)
    expect(deps.currentCancel()).toBeNull()
    expect(mocks.rmSync).not.toHaveBeenCalled()
    expect(mocks.deleteKeychain).not.toHaveBeenCalled()
    expect(mocks.writeLegacy).not.toHaveBeenCalled()
  })
})
