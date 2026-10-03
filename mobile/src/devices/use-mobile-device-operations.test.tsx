import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deviceCatalog } from './mobile-devices.test-fixture'
import { useMobileDeviceOperations } from './use-mobile-device-operations'

let latest!: ReturnType<typeof useMobileDeviceOperations>
let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})
function mount(overrides: Partial<Parameters<typeof useMobileDeviceOperations>[0]> = {}) {
  const args = {
    scope: 'account-a',
    reloadCatalog: vi.fn().mockResolvedValue([]),
    refreshDirectory: vi.fn().mockResolvedValue(undefined),
    forceReconnect: vi.fn().mockResolvedValue(undefined),
    pair: vi.fn(),
    ...overrides
  }
  function Probe({ scope }: { scope: string }) {
    latest = useMobileDeviceOperations({ ...args, scope })
    return null
  }
  act(() => {
    renderer = create(createElement(Probe, { scope: args.scope! }))
  })
  return { args, Probe }
}
describe('device connection controls', () => {
  it('refreshes the account directory and local catalog in order', async () => {
    const { args } = mount()
    await act(async () => latest.refresh())
    expect(args.refreshDirectory).toHaveBeenCalledOnce()
    expect(args.reloadCatalog.mock.invocationCallOrder[0]).toBeGreaterThan(
      args.refreshDirectory.mock.invocationCallOrder[0]
    )
  })
  it('retries a device without changing the selected Runtime', async () => {
    const { args } = mount()
    await act(async () => latest.retry(deviceCatalog[1]))
    expect(args.forceReconnect).toHaveBeenCalledExactlyOnceWith('device-1')
  })
  it('reloads unavailable credentials and routes expired local pairing to the existing scan flow', async () => {
    const { args } = mount()
    await act(async () =>
      latest.retry({ ...deviceCatalog[0], credentialStatus: 'temporarily-unavailable' })
    )
    expect(args.forceReconnect).not.toHaveBeenCalled()
    expect(args.reloadCatalog).toHaveBeenCalledOnce()
    await act(async () =>
      latest.retry({ ...deviceCatalog[0], credentialStatus: 'missing', profile: null })
    )
    expect(args.pair).toHaveBeenCalledOnce()
  })
  it('prevents overlapping refreshes and drops pending work after an account change', async () => {
    let resolve!: () => void
    const { args, Probe } = mount({
      refreshDirectory: vi.fn().mockReturnValue(
        new Promise<void>((reply) => {
          resolve = reply
        })
      )
    })
    let pending!: Promise<void>
    act(() => {
      pending = latest.refresh()
    })
    await act(async () => latest.refresh())
    expect(args.refreshDirectory).toHaveBeenCalledOnce()
    act(() => renderer!.update(createElement(Probe, { scope: 'account-b' })))
    await act(async () => {
      resolve()
      await pending
    })
    expect(args.reloadCatalog).not.toHaveBeenCalled()
    expect(latest.refreshing).toBe(false)
  })
  it('surfaces retry failures and allows the next retry', async () => {
    const { args } = mount({
      forceReconnect: vi
        .fn()
        .mockRejectedValueOnce(new Error('网络不可用'))
        .mockResolvedValue(undefined)
    })
    await act(async () => latest.retry(deviceCatalog[1]))
    expect(latest.error).toBe('网络不可用')
    expect(latest.pendingId).toBeNull()
    await act(async () => latest.retry(deviceCatalog[1]))
    expect(args.forceReconnect).toHaveBeenCalledTimes(2)
    expect(latest.error).toBeNull()
  })
  it('rejects a callback captured before the account scope changed', async () => {
    const { args, Probe } = mount()
    const previousRetry = latest.retry
    act(() => renderer!.update(createElement(Probe, { scope: 'account-b' })))
    await act(async () => previousRetry(deviceCatalog[2]))
    expect(args.forceReconnect).not.toHaveBeenCalled()
    expect(args.refreshDirectory).not.toHaveBeenCalled()
  })
  it.each([
    { accessSources: ['manual-pairing'] as const, pair: true },
    { accessSources: ['manual-pairing', 'account-claimed'] as const, pair: true },
    { accessSources: ['account-claimed'] as const, pair: false }
  ])(
    'repairs rejected local credentials without treating account-only credentials as a pairing ($accessSources)',
    async ({ accessSources, pair }) => {
      const { args } = mount()
      await act(async () =>
        latest.retry({ ...deviceCatalog[0], accessSources: [...accessSources] }, true)
      )
      expect(args.pair).toHaveBeenCalledTimes(pair ? 1 : 0)
      expect(args.forceReconnect).toHaveBeenCalledTimes(pair ? 0 : 1)
    }
  )
  it('does not dispatch a captured operation after the devices page unmounts', async () => {
    const { args } = mount()
    const previousRetry = latest.retry
    act(() => {
      renderer!.unmount()
      renderer = null
    })
    await act(async () => previousRetry(deviceCatalog[2]))
    expect(args.forceReconnect).not.toHaveBeenCalled()
  })
})
