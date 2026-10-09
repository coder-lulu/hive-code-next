// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getCachedWindowsTerminalCapabilities,
  loadWindowsTerminalCapabilities,
  resetWindowsTerminalCapabilitiesForTests
} from './windows-terminal-capabilities'
import { resetWindowsTerminalCapabilityReprobeForTests } from './windows-terminal-capability-reprobe'

describe('Windows terminal capability probe ordering', () => {
  afterEach(() => {
    resetWindowsTerminalCapabilitiesForTests()
    resetWindowsTerminalCapabilityReprobeForTests()
    vi.unstubAllGlobals()
  })

  it('coalesces forced same-owner probes and publishes one host identity proof', async () => {
    let resolveStatus!: (status: {
      hostPlatform: NodeJS.Platform
      windowsProcessStartTimeAvailable: boolean
    }) => void
    const pendingStatus = new Promise<{
      hostPlatform: NodeJS.Platform
      windowsProcessStartTimeAvailable: boolean
    }>((resolve) => {
      resolveStatus = resolve
    })
    const runtimeGetStatus = vi.fn().mockReturnValue(pendingStatus)
    vi.stubGlobal('window', {
      api: {
        wsl: {
          isAvailable: vi.fn().mockResolvedValue(false),
          listDistros: vi.fn().mockResolvedValue([])
        },
        pwsh: { isAvailable: vi.fn().mockResolvedValue(false) },
        gitBash: { isAvailable: vi.fn().mockResolvedValue(false) },
        runtime: { getStatus: runtimeGetStatus }
      }
    })

    const olderProbe = loadWindowsTerminalCapabilities({
      ownerKey: 'local',
      force: true,
      now: 1_000
    })
    const newerProbe = loadWindowsTerminalCapabilities({
      ownerKey: 'local',
      force: true,
      now: 2_000
    })

    expect(newerProbe).toBe(olderProbe)
    expect(runtimeGetStatus).toHaveBeenCalledTimes(1)
    resolveStatus({ hostPlatform: 'win32', windowsProcessStartTimeAvailable: true })
    const identityProof = { hostPlatform: 'win32', windowsProcessStartTimeAvailable: true }
    await expect(newerProbe).resolves.toMatchObject(identityProof)
    await expect(olderProbe).resolves.toMatchObject(identityProof)
    expect(getCachedWindowsTerminalCapabilities('local')).toMatchObject(identityProof)
  })
  it.each([true, false, undefined])(
    'retains only the actual advertised identity capability: %s',
    async (advertised) => {
      const runtimeGetStatus = vi.fn().mockResolvedValue({
        hostPlatform: 'win32',
        ...(advertised === undefined ? {} : { windowsProcessStartTimeAvailable: advertised })
      })
      vi.stubGlobal('window', {
        api: {
          wsl: {
            isAvailable: vi.fn().mockResolvedValue(false),
            listDistros: vi.fn().mockResolvedValue([])
          },
          pwsh: { isAvailable: vi.fn().mockResolvedValue(false) },
          gitBash: { isAvailable: vi.fn().mockResolvedValue(false) },
          runtime: { getStatus: runtimeGetStatus }
        }
      })

      const capabilities = await loadWindowsTerminalCapabilities({ ownerKey: 'local', force: true })

      expect(runtimeGetStatus).toHaveBeenCalledOnce()
      expect(capabilities.hostPlatform).toBe('win32')
      if (advertised === undefined) {
        expect(capabilities).not.toHaveProperty('windowsProcessStartTimeAvailable')
      } else {
        expect(capabilities.windowsProcessStartTimeAvailable).toBe(advertised)
      }
      expect(getCachedWindowsTerminalCapabilities('local')).toEqual(capabilities)
    }
  )
})
