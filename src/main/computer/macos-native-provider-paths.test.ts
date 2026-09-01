import { existsSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({ existsSync: vi.fn() }))

import {
  resolveMacOSComputerUseAppPath,
  resolveMacOSComputerUseExecutablePath
} from './macos-native-provider-paths'

const existsSyncMock = vi.mocked(existsSync)

describe('macOS computer-use helper paths', () => {
  afterEach(() => {
    delete process.env.ORCA_COMPUTER_MACOS_HELPER_APP_PATH
    existsSyncMock.mockReset()
  })

  it('prefers the HiveCode app bundle and retains the legacy bundle as a fallback', () => {
    existsSyncMock.mockImplementation((candidate) =>
      String(candidate).endsWith('HiveCode Computer Use.app')
    )

    expect(resolveMacOSComputerUseAppPath()).toMatch(/HiveCode Computer Use\.app$/)
  })

  it('can reuse an installed legacy helper bundle during upgrades', () => {
    existsSyncMock.mockImplementation(
      (candidate) =>
        String(candidate).endsWith('Orca Computer Use.app') ||
        String(candidate).endsWith('orca-computer-use-macos')
    )

    expect(resolveMacOSComputerUseExecutablePath()).toMatch(
      /Orca Computer Use\.app[\\/]Contents[\\/]MacOS[\\/]orca-computer-use-macos$/
    )
  })
})
