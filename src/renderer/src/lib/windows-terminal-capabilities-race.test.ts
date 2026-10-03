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
})
