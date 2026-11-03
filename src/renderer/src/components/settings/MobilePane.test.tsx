// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetPairedMobileDevicesCacheForTests,
  type PairedMobileDevice
} from '../mobile/paired-mobile-devices'

type PairedDevice = PairedMobileDevice

type PairedDevicesProps = {
  devices: readonly PairedDevice[]
  hasQrCode: boolean
  onRevokeDevice: (deviceId: string) => void
}

type StoreState = {
  orcaProfileAuthStatus: { state: 'connected' | 'local' }
  settingsSearchQuery: string
  settings: {
    mobileAutoRestoreFitMs: number | null
    mobilePairingCustomAddress?: string | null
    mobilePairingCustomAddresses?: string[]
  }
  updateSettings: (patch: Record<string, unknown>) => Promise<void>
  recordFeatureInteraction: (feature: string) => void
  fetchOrcaProfileAuthStatus: () => Promise<unknown>
}

const mocks = vi.hoisted(() => {
  const holder: { state: StoreState } = { state: {} as StoreState }
  const useAppStore = Object.assign(
    (selector: (state: StoreState) => unknown) => selector(holder.state),
    { getState: () => holder.state }
  )
  return {
    holder,
    useAppStore,
    latestPairedDevicesProps: null as PairedDevicesProps | null,
    getPairingQR: vi.fn(),
    listDevices: vi.fn(),
    listNetworkInterfaces: vi.fn(),
    revokeDevice: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
    updateSettings: vi.fn()
  }
})

vi.mock('@/store', () => ({ useAppStore: mocks.useAppStore }))
vi.mock('../../store', () => ({ useAppStore: mocks.useAppStore }))

vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('sonner', () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess
  }
}))
vi.mock('./mobile-pairing-device-polling', () => ({ useMobilePairingDevicePolling: vi.fn() }))

// Stub sections to isolate MobilePane’s mode safety, generation gate and persistence.
vi.mock('./MobilePairingSetupSection', () => ({
  MobilePairingSetupSection: (props: {
    canGenerate?: boolean
    loading: boolean
    connectionPathControl: React.ReactNode
    networkInterfaces: { name: string; address: string }[]
    customAddresses: readonly string[]
    selectedAddress: string | undefined
    selectedAddressIsCustom: boolean
    onSelectedAddressChange: (address: string) => void
    onCustomAddressSelect: (address: string) => void
    beforeCustomAddressChange: (address: string) => Promise<boolean>
    onCustomAddressRemove: (address: string) => void
    refreshingNetworkInterfaces: boolean
    onRefreshNetworkInterfaces: () => void
    onGenerateQr: () => void
  }) => (
    <div>
      <span data-testid="can-generate">{String(props.canGenerate)}</span>
      <span data-testid="loading">{String(props.loading)}</span>
      <span data-testid="selected-address">{props.selectedAddress ?? 'none'}</span>
      <span data-testid="selected-address-is-custom">{String(props.selectedAddressIsCustom)}</span>
      <span data-testid="custom-addresses">{props.customAddresses.join(',')}</span>
      <span data-testid="refreshing-addresses">{String(props.refreshingNetworkInterfaces)}</span>
      {props.connectionPathControl}
      {/* Mirror real generation gating so wedged loading state remains observable. */}
      <button
        type="button"
        onClick={props.onGenerateQr}
        disabled={props.loading || props.canGenerate === false}
      >
        Generate
      </button>
      <button
        type="button"
        onClick={async () => {
          const address = '100.126.117.25:6768'
          if (await props.beforeCustomAddressChange(address)) {
            props.onCustomAddressSelect(address)
          }
        }}
      >
        choose-custom-address
      </button>
      <button type="button" onClick={() => props.onCustomAddressRemove('100.126.117.25:6768')}>
        remove-custom-address
      </button>
      <button
        type="button"
        disabled={props.networkInterfaces.length === 0}
        onClick={() => props.onSelectedAddressChange(props.networkInterfaces[0]!.address)}
      >
        choose-discovered-address
      </button>
      <button type="button" onClick={props.onRefreshNetworkInterfaces}>
        refresh-addresses
      </button>
    </div>
  )
}))
vi.mock('./MobilePairingQrSection', () => ({
  MobilePairingQrSection: (props: {
    qrDataUrl: string | null
    pairingUrl: string | null
    qrError: boolean
  }) => (
    <div>
      <span data-testid="qr">{props.qrDataUrl ?? 'none'}</span>
      <span data-testid="pairing-url">{props.pairingUrl ?? 'none'}</span>
      <span data-testid="qr-error">{String(props.qrError)}</span>
    </div>
  )
}))
vi.mock('./MobilePairedDevicesSection', () => ({
  MobilePairedDevicesSection: (props: PairedDevicesProps) => {
    mocks.latestPairedDevicesProps = props
    return <div data-testid="paired-devices">{props.devices.map((d) => d.deviceId).join(',')}</div>
  }
}))
vi.mock('./MobileAutoRestoreFitSection', () => ({ MobileAutoRestoreFitSection: () => <div /> }))
vi.mock('../mobile/WindowsFirewallNotice', () => ({
  WindowsFirewallNotice: (props: { usingRelay?: boolean }) => (
    <div data-testid="firewall-notice">{String(props.usingRelay)}</div>
  )
}))

import { MobilePane } from './MobilePane'
import { MobileDeviceAccessSettings } from './MobileDeviceAccessSettings'

describe('MobilePane direct pairing', () => {
  const getPairingQR = mocks.getPairingQR
  const updateSettings = mocks.updateSettings

  beforeEach(() => {
    vi.clearAllMocks()
    _resetPairedMobileDevicesCacheForTests()
    mocks.latestPairedDevicesProps = null
    getPairingQR.mockReset().mockResolvedValue({
      available: true,
      qrDataUrl: 'data:image/png;base64,qr',
      pairingUrl: 'orca://pair',
      endpoint: 'ws://host'
    })
    mocks.listDevices.mockReset().mockResolvedValue({ devices: [] })
    mocks.listNetworkInterfaces.mockReset().mockResolvedValue({ interfaces: [] })
    mocks.revokeDevice.mockReset().mockResolvedValue({ revoked: true })
    updateSettings.mockReset().mockResolvedValue(undefined)
    mocks.holder.state = {
      orcaProfileAuthStatus: { state: 'connected' },
      settingsSearchQuery: '',
      settings: { mobileAutoRestoreFitMs: null },
      updateSettings,
      recordFeatureInteraction: vi.fn(),
      fetchOrcaProfileAuthStatus: vi.fn().mockResolvedValue(null)
    }
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        mobile: {
          getPairingQR,
          listDevices: mocks.listDevices,
          listNetworkInterfaces: mocks.listNetworkInterfaces,
          revokeDevice: mocks.revokeDevice
        },
        ui: { writeClipboardText: vi.fn().mockResolvedValue(undefined) }
      }
    })
  })

  afterEach(() => {
    cleanup()
    _resetPairedMobileDevicesCacheForTests()
    document.body.innerHTML = ''
  })

  it('allows a local profile to create a direct offer without cloud authentication', async () => {
    mocks.holder.state.orcaProfileAuthStatus = { state: 'local' }
    render(<MobilePane />)
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }))
    await waitFor(() => expect(getPairingQR).toHaveBeenCalledWith({}))
    expect(screen.getByTestId('pairing-url')).toHaveTextContent('orca://pair')
  })

  it('waits for initial discovery before minting the selected address', async () => {
    let resolveInterfaces: (value: {
      interfaces: { name: string; address: string }[]
    }) => void = () => {}
    mocks.listNetworkInterfaces.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveInterfaces = resolve
        })
    )
    render(<MobilePane />)
    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }))
    expect(getPairingQR).not.toHaveBeenCalled()
    expect(screen.getByTestId('loading')).toHaveTextContent('false')
    await act(async () =>
      resolveInterfaces({ interfaces: [{ name: 'Ethernet', address: '10.0.0.2' }] })
    )
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }))
    expect(getPairingQR).toHaveBeenCalledExactlyOnceWith({ address: '10.0.0.2' })
  })

  it('only applies the latest discovery and keeps its refresh busy', async () => {
    let resolveOlder: (value: {
      interfaces: { name: string; address: string }[]
    }) => void = () => {}
    let resolveLatest: (value: {
      interfaces: { name: string; address: string }[]
    }) => void = () => {}
    mocks.listNetworkInterfaces
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOlder = resolve
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLatest = resolve
          })
      )
    render(<MobilePane />)
    await userEvent.click(screen.getByRole('button', { name: 'refresh-addresses' }))
    await act(async () => resolveOlder({ interfaces: [{ name: 'Old', address: '10.0.0.1' }] }))
    expect(screen.getByTestId('selected-address')).toHaveTextContent('none')
    expect(screen.getByTestId('refreshing-addresses')).toHaveTextContent('true')
    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled()
    await act(async () => resolveLatest({ interfaces: [{ name: 'Latest', address: '10.0.0.2' }] }))
    expect(screen.getByTestId('selected-address')).toHaveTextContent('10.0.0.2')
    expect(screen.getByTestId('refreshing-addresses')).toHaveTextContent('false')
  })

  it('ignores an older discovery after a custom address passes preflight', async () => {
    let resolveInterfaces: (value: {
      interfaces: { name: string; address: string }[]
    }) => void = () => {}
    mocks.listNetworkInterfaces.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveInterfaces = resolve
        })
    )
    render(<MobilePane />)
    await userEvent.click(screen.getByRole('button', { name: 'choose-custom-address' }))
    expect(getPairingQR).toHaveBeenCalledExactlyOnceWith({ address: '100.126.117.25:6768' })
    await act(async () =>
      resolveInterfaces({ interfaces: [{ name: 'Stale', address: '10.0.0.1' }] })
    )
    expect(screen.getByTestId('selected-address')).toHaveTextContent('100.126.117.25:6768')
    expect(screen.getByRole('button', { name: 'choose-discovered-address' })).toBeDisabled()
    expect(screen.getByTestId('refreshing-addresses')).toHaveTextContent('false')
  })

  it('does not let an older lookup replace a completed newer discovery', async () => {
    let resolveOlder: (value: {
      interfaces: { name: string; address: string }[]
    }) => void = () => {}
    mocks.listNetworkInterfaces
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOlder = resolve
          })
      )
      .mockResolvedValueOnce({ interfaces: [{ name: 'Latest', address: '10.0.0.2' }] })
    render(<MobilePane />)
    await userEvent.click(screen.getByRole('button', { name: 'refresh-addresses' }))
    expect(screen.getByTestId('selected-address')).toHaveTextContent('10.0.0.2')
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }))
    await act(async () => resolveOlder({ interfaces: [{ name: 'Stale', address: '10.0.0.1' }] }))
    expect(screen.getByTestId('selected-address')).toHaveTextContent('10.0.0.2')
    expect(screen.getByTestId('pairing-url')).toHaveTextContent('orca://pair')
    expect(getPairingQR).toHaveBeenCalledExactlyOnceWith({ address: '10.0.0.2' })
  })

  it('rejects a pending custom preflight after selecting a discovered address', async () => {
    mocks.listNetworkInterfaces.mockResolvedValue({
      interfaces: [{ name: 'Ethernet', address: '10.0.0.2' }]
    })
    let resolvePreflight: (result: Record<string, unknown>) => void = () => {}
    getPairingQR.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePreflight = resolve
        })
    )
    render(<MobilePane />)
    await userEvent.click(screen.getByRole('button', { name: 'choose-custom-address' }))
    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'choose-discovered-address' }))
    await act(async () =>
      resolvePreflight({
        available: true,
        qrDataUrl: 'preflight-qr',
        pairingUrl: 'orca://preflight'
      })
    )
    expect(updateSettings).not.toHaveBeenCalled()
    expect(screen.getByTestId('selected-address')).toHaveTextContent('10.0.0.2')
    expect(screen.getByRole('button', { name: 'Generate' })).toBeEnabled()
  })

  it.each(['encoding', 'unavailable', 'rejection'])(
    'does not persist a custom address after %s preflight failure',
    async (failure) => {
      render(<MobilePane />)
      await waitFor(() => expect(screen.getByRole('button', { name: 'Generate' })).toBeEnabled())
      if (failure === 'rejection') {
        getPairingQR.mockRejectedValueOnce(new Error('preflight failed'))
      } else {
        getPairingQR.mockResolvedValueOnce({
          available: failure !== 'unavailable',
          qrDataUrl: null,
          pairingUrl: 'orca://copy-only'
        })
      }
      await userEvent.click(screen.getByRole('button', { name: 'choose-custom-address' }))
      expect(getPairingQR).toHaveBeenCalledExactlyOnceWith({ address: '100.126.117.25:6768' })
      expect(updateSettings).not.toHaveBeenCalled()
      expect(screen.getByTestId('selected-address')).toHaveTextContent('none')
      expect(screen.getByTestId('custom-addresses')).toBeEmptyDOMElement()
      expect(mocks.toastError).toHaveBeenCalledWith('Failed to generate QR code')
    }
  )

  it('rotates copy-only credentials on repeat generation and address removal', async () => {
    mocks.holder.state.settings = {
      mobileAutoRestoreFitMs: null,
      mobilePairingCustomAddress: '100.126.117.25:6768',
      mobilePairingCustomAddresses: ['100.126.117.25:6768']
    }
    mocks.listNetworkInterfaces.mockResolvedValue({
      interfaces: [{ name: 'Ethernet', address: '10.0.0.2' }]
    })
    getPairingQR.mockResolvedValue({
      available: true,
      qrDataUrl: null,
      pairingUrl: 'orca://copy-only',
      endpoint: 'ws://host'
    })
    render(<MobilePane />)
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }))
    expect(screen.getByTestId('pairing-url')).toHaveTextContent('orca://copy-only')
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }))
    expect(getPairingQR).toHaveBeenLastCalledWith({ address: '100.126.117.25:6768', rotate: true })
    await userEvent.click(screen.getByRole('button', { name: 'remove-custom-address' }))
    expect(screen.getByTestId('pairing-url')).toHaveTextContent('none')
    expect(screen.getByTestId('selected-address')).toHaveTextContent('10.0.0.2')
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }))
    expect(getPairingQR).toHaveBeenLastCalledWith({ address: '10.0.0.2', rotate: true })
  })

  it('ignores a pending offer after unmount and preserves a new visit', async () => {
    let resolveOffer: (result: Record<string, unknown>) => void = () => {}
    getPairingQR.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOffer = resolve
        })
    )
    const firstVisit = render(<MobilePane />)
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }))
    firstVisit.unmount()
    const recordFeatureInteraction = mocks.holder.state.recordFeatureInteraction
    render(<MobilePane />)
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }))
    expect(screen.getByTestId('pairing-url')).toHaveTextContent('orca://pair')
    await act(async () =>
      resolveOffer({ available: true, qrDataUrl: 'stale', pairingUrl: 'orca://stale' })
    )
    expect(screen.getByTestId('pairing-url')).toHaveTextContent('orca://pair')
    expect(recordFeatureInteraction).toHaveBeenCalledTimes(1)
  })

  it('retains the offer across Devices visibility changes', async () => {
    const view = render(<MobilePane active />)
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }))
    view.rerender(<MobilePane active={false} />)
    view.rerender(<MobilePane active />)
    expect(screen.getByTestId('pairing-url')).toHaveTextContent('orca://pair')
    expect(getPairingQR).toHaveBeenCalledTimes(1)
  })

  it('reports an unavailable transport without showing a pairing code', async () => {
    getPairingQR.mockResolvedValue({ available: false, guidance: 'Host transport is unavailable' })
    render(<MobilePane />)
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }))
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('Host transport is unavailable')
    )
    expect(screen.getByTestId('pairing-url')).toHaveTextContent('none')
    expect(screen.getByRole('button', { name: 'Generate' })).toBeEnabled()
  })

  it('rejects a late offer after the address changes and rotates the next request', async () => {
    let resolveOffer: (result: Record<string, unknown>) => void = () => {}
    getPairingQR.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOffer = resolve
        })
    )
    render(<MobilePane />)
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }))
    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'choose-custom-address' }))
    expect(screen.getByRole('button', { name: 'Generate' })).toBeEnabled()
    await act(async () => {
      resolveOffer({ available: true, pairingUrl: 'orca://stale', qrDataUrl: 'stale-qr' })
    })
    expect(screen.getByTestId('pairing-url')).toHaveTextContent('none')
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }))
    expect(getPairingQR).toHaveBeenLastCalledWith({ address: '100.126.117.25:6768', rotate: true })
    await waitFor(() => expect(screen.getByTestId('pairing-url')).toHaveTextContent('orca://pair'))
  })

  it('applies a new navigation request while preserving independent cloud and direct owners', () => {
    const cloud = <div>Cloud connection owner</div>
    const { rerender } = render(
      <MobilePane
        cloudConnection={cloud}
        requestedConnectionMethod="cloud"
        navigationRevision={1}
      />
    )
    expect(screen.getByRole('tab', { name: 'HiveCloud account' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    rerender(
      <MobilePane
        cloudConnection={cloud}
        requestedConnectionMethod="direct"
        navigationRevision={2}
      />
    )
    expect(screen.getByRole('tab', { name: 'Direct address' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(getPairingQR).not.toHaveBeenCalled()
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('keeps the copy fallback when QR encoding fails', async () => {
    getPairingQR.mockResolvedValue({
      available: true,
      qrDataUrl: null,
      qrError: 'encoding_failed',
      pairingUrl: 'orca://pair?code=copy-fallback',
      endpoint: 'wss://host.example/large'
    })
    const user = userEvent.setup()
    render(<MobilePane />)

    await user.click(screen.getByRole('button', { name: 'Generate' }))

    await waitFor(() => expect(screen.getByTestId('qr-error')).toHaveTextContent('true'))
    expect(screen.getByTestId('qr')).toHaveTextContent('none')
    expect(screen.getByTestId('pairing-url')).toHaveTextContent('copy-fallback')
  })

  it('restores a saved custom address for future pairing codes', async () => {
    mocks.holder.state.settings = {
      mobileAutoRestoreFitMs: null,
      mobilePairingCustomAddress: '100.126.117.25:6768'
    }
    mocks.listNetworkInterfaces.mockResolvedValue({
      interfaces: [{ name: 'Ethernet', address: '10.0.0.2' }]
    })
    const user = userEvent.setup()
    render(<MobilePane />)

    await waitFor(() =>
      expect(screen.getByTestId('selected-address')).toHaveTextContent('100.126.117.25:6768')
    )
    await user.click(screen.getByRole('button', { name: 'Generate' }))
    await waitFor(() =>
      expect(getPairingQR).toHaveBeenCalledWith({
        address: '100.126.117.25:6768'
      })
    )
  })

  it('persists a custom address and clears it when a discovered address is selected', async () => {
    mocks.listNetworkInterfaces.mockResolvedValue({
      interfaces: [{ name: 'Ethernet', address: '10.0.0.2' }]
    })
    const user = userEvent.setup()
    render(<MobilePane />)
    await waitFor(() => expect(mocks.listNetworkInterfaces).toHaveBeenCalledOnce())

    await user.click(screen.getByRole('button', { name: 'choose-custom-address' }))
    expect(updateSettings).toHaveBeenCalledWith({
      mobilePairingCustomAddress: '100.126.117.25:6768',
      mobilePairingCustomAddresses: ['100.126.117.25:6768']
    })
    expect(screen.getByTestId('selected-address')).toHaveTextContent('100.126.117.25:6768')
    expect(screen.getByTestId('selected-address-is-custom')).toHaveTextContent('true')
    expect(screen.getByTestId('custom-addresses')).toHaveTextContent('100.126.117.25:6768')

    await user.click(screen.getByRole('button', { name: 'choose-discovered-address' }))
    expect(updateSettings).toHaveBeenCalledWith({ mobilePairingCustomAddress: null })
    expect(screen.getByTestId('selected-address')).toHaveTextContent('10.0.0.2')
    expect(screen.getByTestId('custom-addresses')).toHaveTextContent('100.126.117.25:6768')
  })

  it('keeps the current pairing code when the active custom address is reselected', async () => {
    const customAddress = '100.126.117.25:6768'
    mocks.holder.state.settings = {
      mobileAutoRestoreFitMs: null,
      mobilePairingCustomAddress: customAddress,
      mobilePairingCustomAddresses: [customAddress]
    }
    const user = userEvent.setup()
    render(<MobilePane />)

    await user.click(screen.getByRole('button', { name: 'Generate' }))
    await waitFor(() => expect(screen.getByTestId('qr')).toHaveTextContent('base64,qr'))
    getPairingQR.mockClear()
    updateSettings.mockClear()

    await user.click(screen.getByRole('button', { name: 'choose-custom-address' }))

    expect(updateSettings).not.toHaveBeenCalled()
    expect(getPairingQR).not.toHaveBeenCalled()
    expect(screen.getByTestId('qr')).toHaveTextContent('base64,qr')
  })

  it('keeps the current pairing code when only custom address intent changes', async () => {
    const address = '100.126.117.25:6768'
    mocks.holder.state.settings = {
      mobileAutoRestoreFitMs: null,
      mobilePairingCustomAddress: address,
      mobilePairingCustomAddresses: [address]
    }
    mocks.listNetworkInterfaces.mockResolvedValue({
      interfaces: [{ name: 'Tailscale', address }]
    })
    const user = userEvent.setup()
    render(<MobilePane />)
    await waitFor(() => expect(mocks.listNetworkInterfaces).toHaveBeenCalledOnce())
    await user.click(screen.getByRole('button', { name: 'Generate' }))
    await waitFor(() => expect(screen.getByTestId('qr')).toHaveTextContent('base64,qr'))
    getPairingQR.mockClear()
    updateSettings.mockClear()

    await user.click(screen.getByRole('button', { name: 'choose-discovered-address' }))

    expect(updateSettings).toHaveBeenCalledWith({ mobilePairingCustomAddress: null })
    expect(getPairingQR).not.toHaveBeenCalled()
    expect(screen.getByTestId('qr')).toHaveTextContent('base64,qr')
    expect(screen.getByTestId('selected-address-is-custom')).toHaveTextContent('false')

    updateSettings.mockClear()
    await user.click(screen.getByRole('button', { name: 'choose-custom-address' }))
    expect(updateSettings).toHaveBeenCalledWith({
      mobilePairingCustomAddress: address,
      mobilePairingCustomAddresses: [address]
    })
    updateSettings.mockClear()
    await user.click(screen.getByRole('button', { name: 'remove-custom-address' }))

    expect(updateSettings).toHaveBeenCalledWith({
      mobilePairingCustomAddress: null,
      mobilePairingCustomAddresses: []
    })
    expect(getPairingQR).not.toHaveBeenCalled()
    expect(screen.getByTestId('qr')).toHaveTextContent('base64,qr')
    expect(screen.getByTestId('selected-address-is-custom')).toHaveTextContent('false')
  })

  it('removes the selected custom address and falls back to discovery', async () => {
    const customAddress = '100.126.117.25:6768'
    mocks.holder.state.settings = {
      mobileAutoRestoreFitMs: null,
      mobilePairingCustomAddress: customAddress,
      mobilePairingCustomAddresses: [customAddress, 'second.example:6768']
    }
    mocks.listNetworkInterfaces.mockResolvedValue({
      interfaces: [{ name: 'Ethernet', address: '10.0.0.2' }]
    })
    const user = userEvent.setup()
    render(<MobilePane />)
    await waitFor(() =>
      expect(screen.getByTestId('selected-address')).toHaveTextContent(customAddress)
    )

    await user.click(screen.getByRole('button', { name: 'remove-custom-address' }))

    expect(updateSettings).toHaveBeenCalledWith({
      mobilePairingCustomAddress: null,
      mobilePairingCustomAddresses: ['second.example:6768']
    })
    expect(screen.getByTestId('selected-address')).toHaveTextContent('10.0.0.2')
    expect(screen.getByTestId('selected-address-is-custom')).toHaveTextContent('false')
  })

  it('removes an inactive custom address without changing the selection', async () => {
    mocks.holder.state.settings = {
      mobileAutoRestoreFitMs: null,
      mobilePairingCustomAddress: 'second.example:6768',
      mobilePairingCustomAddresses: ['100.126.117.25:6768', 'second.example:6768']
    }
    const user = userEvent.setup()
    render(<MobilePane />)

    await user.click(screen.getByRole('button', { name: 'remove-custom-address' }))

    expect(updateSettings).toHaveBeenCalledWith({
      mobilePairingCustomAddresses: ['second.example:6768']
    })
    expect(screen.getByTestId('selected-address')).toHaveTextContent('second.example:6768')
    expect(screen.getByTestId('selected-address-is-custom')).toHaveTextContent('true')
  })

  it('keeps a saved custom override when discovery later stops listing it', async () => {
    const customAddress = '100.126.117.25:6768'
    mocks.holder.state.settings = {
      mobileAutoRestoreFitMs: null,
      mobilePairingCustomAddress: customAddress
    }
    mocks.listNetworkInterfaces.mockResolvedValueOnce({
      interfaces: [{ name: 'Tailscale', address: customAddress }]
    })
    const user = userEvent.setup()
    render(<MobilePane />)
    await waitFor(() =>
      expect(screen.getByTestId('selected-address')).toHaveTextContent(customAddress)
    )

    let resolveRefresh: ((value: Record<string, unknown>) => void) | undefined
    mocks.listNetworkInterfaces.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve
        })
    )
    await user.click(screen.getByRole('button', { name: 'refresh-addresses' }))
    expect(screen.getByTestId('refreshing-addresses')).toHaveTextContent('true')

    resolveRefresh?.({ interfaces: [{ name: 'Ethernet', address: '10.0.0.2' }] })
    await waitFor(() =>
      expect(screen.getByTestId('refreshing-addresses')).toHaveTextContent('false')
    )

    expect(screen.getByTestId('selected-address')).toHaveTextContent(customAddress)
    expect(updateSettings).not.toHaveBeenCalled()
  })
})

const mountedRoots: Root[] = []

function pairedDevice(deviceId: string): PairedDevice {
  return {
    deviceId,
    name: deviceId,
    pairedAt: 1,
    lastSeenAt: 2
  }
}

async function renderMobilePane(): Promise<void> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push(root)
  await act(async () => {
    root.render(<MobileDeviceAccessSettings active />)
  })
}

async function unmountMobilePaneRoots(): Promise<void> {
  await act(async () => {
    for (const root of mountedRoots.splice(0)) {
      root.unmount()
    }
  })
}

describe('MobileDeviceAccessSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetPairedMobileDevicesCacheForTests()
    mocks.latestPairedDevicesProps = null
    mocks.getPairingQR.mockReset().mockResolvedValue({
      available: true,
      qrDataUrl: 'data:image/png;base64,qr',
      pairingUrl: 'orca://pair',
      endpoint: 'ws://host'
    })
    mocks.listDevices.mockReset()
    mocks.listNetworkInterfaces.mockReset().mockResolvedValue({ interfaces: [] })
    mocks.revokeDevice.mockReset()
    mocks.updateSettings.mockReset().mockResolvedValue(undefined)
    mocks.holder.state = {
      orcaProfileAuthStatus: { state: 'connected' },
      settingsSearchQuery: '',
      settings: { mobileAutoRestoreFitMs: null },
      updateSettings: mocks.updateSettings,
      recordFeatureInteraction: vi.fn(),
      fetchOrcaProfileAuthStatus: vi.fn().mockResolvedValue(null)
    }
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        mobile: {
          getPairingQR: mocks.getPairingQR,
          listDevices: mocks.listDevices,
          listNetworkInterfaces: mocks.listNetworkInterfaces,
          revokeDevice: mocks.revokeDevice
        }
      }
    })
  })

  afterEach(async () => {
    await unmountMobilePaneRoots()
    _resetPairedMobileDevicesCacheForTests()
    document.body.innerHTML = ''
  })

  it('refreshes paired devices from the backend after revoking one', async () => {
    mocks.listDevices
      .mockResolvedValueOnce({ devices: [pairedDevice('phone-1')] })
      .mockResolvedValueOnce({ devices: [pairedDevice('phone-2')] })
    mocks.revokeDevice.mockResolvedValue({ revoked: true })

    await renderMobilePane()

    await vi.waitFor(() =>
      expect(mocks.latestPairedDevicesProps?.devices.map((d) => d.deviceId)).toEqual(['phone-1'])
    )

    await act(async () => {
      mocks.latestPairedDevicesProps?.onRevokeDevice('phone-1')
    })

    await vi.waitFor(() => expect(mocks.revokeDevice).toHaveBeenCalledWith({ deviceId: 'phone-1' }))
    await vi.waitFor(() =>
      expect(mocks.latestPairedDevicesProps?.devices.map((d) => d.deviceId)).toEqual(['phone-2'])
    )
    // Require a successful revoke toast first so the unmount test cannot pass if toasts disappear entirely.
    await vi.waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledTimes(1))
  })

  it('shows an error and keeps the device when revoke returns revoked:false', async () => {
    mocks.listDevices.mockResolvedValue({ devices: [pairedDevice('phone-1')] })
    mocks.revokeDevice.mockResolvedValue({ revoked: false })

    await renderMobilePane()

    await vi.waitFor(() =>
      expect(mocks.latestPairedDevicesProps?.devices.map((d) => d.deviceId)).toEqual(['phone-1'])
    )

    await act(async () => {
      mocks.latestPairedDevicesProps?.onRevokeDevice('phone-1')
    })

    await vi.waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1))
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    // A revoke that did not happen must not fire a second (refresh) IPC call.
    expect(mocks.listDevices).toHaveBeenCalledTimes(1)
    expect(mocks.latestPairedDevicesProps?.devices.map((d) => d.deviceId)).toEqual(['phone-1'])
  })

  it('optimistically drops the revoked device when the post-revoke refresh fails', async () => {
    mocks.listDevices
      .mockResolvedValueOnce({ devices: [pairedDevice('phone-1'), pairedDevice('phone-2')] })
      .mockRejectedValueOnce(new Error('refresh failed'))
    mocks.revokeDevice.mockResolvedValue({ revoked: true })

    await renderMobilePane()

    await vi.waitFor(() =>
      expect(mocks.latestPairedDevicesProps?.devices.map((d) => d.deviceId)).toEqual([
        'phone-1',
        'phone-2'
      ])
    )

    await act(async () => {
      mocks.latestPairedDevicesProps?.onRevokeDevice('phone-1')
    })

    // Failed refresh retains optimistic removal and still reports the successful revoke.
    await vi.waitFor(() =>
      expect(mocks.latestPairedDevicesProps?.devices.map((d) => d.deviceId)).toEqual(['phone-2'])
    )
    await vi.waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledTimes(1))
  })

  it('does not show revoke success after unmounting during the refresh', async () => {
    let resolveRefreshAfterRevoke: (value: { devices: [] }) => void = () => {}
    const refreshAfterRevoke = new Promise<{ devices: [] }>((resolve) => {
      resolveRefreshAfterRevoke = resolve
    })
    mocks.listDevices
      .mockResolvedValueOnce({ devices: [pairedDevice('phone-1')] })
      .mockReturnValueOnce(refreshAfterRevoke)
    mocks.revokeDevice.mockResolvedValue({ revoked: true })

    await renderMobilePane()

    await vi.waitFor(() =>
      expect(mocks.latestPairedDevicesProps?.devices.map((d) => d.deviceId)).toEqual(['phone-1'])
    )

    await act(async () => {
      mocks.latestPairedDevicesProps?.onRevokeDevice('phone-1')
    })

    await vi.waitFor(() => expect(mocks.listDevices).toHaveBeenCalledTimes(2))
    await unmountMobilePaneRoots()

    await act(async () => {
      resolveRefreshAfterRevoke({ devices: [] })
    })

    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })
})
