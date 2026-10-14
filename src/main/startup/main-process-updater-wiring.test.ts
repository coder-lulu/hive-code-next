import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  configured: vi.fn(),
  ensure: vi.fn(),
  register: vi.fn(),
  check: vi.fn(),
  snapshot: vi.fn(),
  download: vi.fn(),
  install: vi.fn()
}))
vi.mock('../../shared/product-update-policy', () => ({
  hasConfiguredProductUpdateChannel: mocks.configured
}))
vi.mock('../window/attach-main-window-services', () => ({
  ensureAutoUpdaterConfigured: mocks.ensure
}))
vi.mock('../runtime/remote-server-updater', () => ({
  configureRemoteServerUpdater: mocks.register
}))
vi.mock('../updater', () => ({
  getRemoteServerUpdaterSnapshot: mocks.snapshot,
  checkForRemoteServerUpdate: mocks.check,
  downloadRemoteServerUpdate: mocks.download,
  installRemoteServerUpdate: mocks.install
}))
import { configureMainProcessRemoteServerUpdater } from './main-process-updater-wiring'
import type { configureRemoteServerUpdater } from '../runtime/remote-server-updater'
beforeEach(() => vi.resetAllMocks())
it.each([
  [false, false, false],
  [true, false, true],
  [false, true, true]
])('configures owned updater for configured=%s local=%s', (configured, localBuild, expected) => {
  mocks.configured.mockReturnValue(configured)
  const result = {
    runtimeId: 'runtime-id',
    appVersion: '1.0.0',
    status: { state: 'idle' },
    support: {
      installMode: 'unsupported-headless-serve',
      automatic: false,
      reason: 'updater-unavailable'
    }
  }
  mocks.check.mockReturnValue(result)
  configureMainProcessRemoteServerUpdater()
  const callbacks = mocks.register.mock.calls[0][0] as Parameters<
    typeof configureRemoteServerUpdater
  >[0]
  const options = { localBuild }
  expect(callbacks.check('runtime-id', options)).toBe(result)
  expect(mocks.check).toHaveBeenCalledWith('runtime-id', options)
  expect(mocks.ensure).toHaveBeenCalledTimes(expected ? 1 : 0)
  expect(callbacks.getSnapshot).toBe(mocks.snapshot)
  expect(callbacks.download).toBe(mocks.download)
  expect(callbacks.install).toBe(mocks.install)
})
