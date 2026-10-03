import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { appMock, readFileMock } = vi.hoisted(() => ({
  appMock: {
    isPackaged: false,
    getAppPath: vi.fn(() => 'C:/HiveCode/resources/app.asar'),
    getVersion: vi.fn(() => '1.5.0-beta.1')
  },
  readFileMock: vi.fn()
}))

vi.mock('electron', () => ({ app: appMock }))
vi.mock('node:fs', () => ({ readFileSync: readFileMock }))

import { getDesktopReleaseIdentity } from './release-identity'

describe('desktop release identity', () => {
  beforeEach(() => {
    appMock.isPackaged = false
    readFileMock.mockReturnValue(
      JSON.stringify({ hivecodeReleaseIdentity: { buildNumber: 42, channel: 'beta' } })
    )
    vi.stubEnv('HIVECODE_BUILD_NUMBER', '999')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('uses embedded build metadata instead of a packaged-process environment override', () => {
    appMock.isPackaged = true

    expect(getDesktopReleaseIdentity().buildNumber).toBe(42)
  })

  it('fails closed when a packaged app has no embedded build identity', () => {
    appMock.isPackaged = true
    readFileMock.mockReturnValue('{}')

    expect(getDesktopReleaseIdentity().buildNumber).toBe(1)
  })

  it('keeps the environment fallback for unbundled development runs', () => {
    readFileMock.mockImplementation(() => {
      throw new Error('package metadata unavailable')
    })

    expect(getDesktopReleaseIdentity().buildNumber).toBe(999)
  })
})
