// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PRIMARY_PAIRING_SCHEME } from '../../../../shared/pairing'

type StoreState = {
  closeMobilePage: () => void
  orcaProfileAuthStatus: { state: 'connected' | 'local' }
  settings: {
    showMobileButton: boolean
    mobilePairingCustomAddress?: string | null
    mobilePairingCustomAddresses?: string[]
  }
  updateSettings: () => Promise<void>
  fetchOrcaProfileAuthStatus: () => Promise<unknown>
}

const mocks = vi.hoisted(() => ({
  storeState: {} as StoreState
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: StoreState) => unknown) => selector(mocks.storeState)
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), message: vi.fn(), success: vi.fn() }
}))

vi.mock('./use-mobile-install-qr', () => ({ useMobileInstallQr: () => null }))
vi.mock('./use-mobile-page-escape', () => ({ useMobilePageEscape: vi.fn() }))
vi.mock('../settings/mobile-pairing-device-polling', () => ({
  useMobilePairingDevicePolling: vi.fn()
}))

vi.mock('./MobilePageContent', () => ({
  MobilePageContent: (props: {
    canGeneratePairing: boolean
    enterFlow: () => void
    handleAddressChange: (address: string) => void
    customAddresses: readonly string[]
    selectedAddressIsCustom: boolean
    onCustomAddressSelect: (address: string) => void
    onCustomAddressRemove: (address: string) => void
    beforeCustomAddressChange: (address: string) => Promise<boolean>
    handleContinue: () => void
    copyPairingCode: () => void
    pairQrDataUrl: string | null
    pairQrSize: number | null
    pairingUrl: string | null
    pairingQrError: boolean
    selectedAddress: string | undefined
    loadNetworkInterfaces: () => void
    openAndroidInstallGuide: () => void
    refreshingNetworkInterfaces: boolean
    stage: string | null
    stepIdx: number
  }) => (
    <div>
      <span data-testid="stage">{props.stage ?? 'loading'}</span>
      <span data-testid="step">{props.stepIdx}</span>
      <span data-testid="can-generate">{String(props.canGeneratePairing)}</span>
      <span data-testid="pairing-qr">{props.pairQrDataUrl ?? 'none'}</span>
      <span data-testid="pairing-qr-size">{props.pairQrSize ?? 'none'}</span>
      <span data-testid="pairing-url">{props.pairingUrl ?? 'none'}</span>
      <span data-testid="pairing-qr-error">{String(props.pairingQrError)}</span>
      <span data-testid="selected-address">{props.selectedAddress ?? 'none'}</span>
      <span data-testid="selected-address-is-custom">{String(props.selectedAddressIsCustom)}</span>
      <span data-testid="custom-addresses">{props.customAddresses.join(',')}</span>
      <span data-testid="refreshing-addresses">{String(props.refreshingNetworkInterfaces)}</span>
      <button type="button" onClick={props.enterFlow}>
        Enter flow
      </button>
      <button type="button" onClick={props.handleContinue}>
        Continue
      </button>
      <button type="button" onClick={props.copyPairingCode}>
        Copy pairing code
      </button>
      <button type="button" onClick={() => props.handleAddressChange('10.0.0.2')}>
        Change address
      </button>
      <button type="button" onClick={props.loadNetworkInterfaces}>
        Refresh addresses
      </button>
      <button type="button" onClick={props.openAndroidInstallGuide}>
        Open Android install guide
      </button>
      <button
        type="button"
        onClick={() =>
          void props.beforeCustomAddressChange('wss://custom.example/large').then((confirmed) => {
            if (confirmed) {
              props.onCustomAddressSelect('wss://custom.example/large')
            }
          })
        }
      >
        Confirm custom address
      </button>
      <button
        type="button"
        onClick={() => props.onCustomAddressRemove('wss://custom.example/large')}
      >
        Remove custom address
      </button>
    </div>
  )
}))

import MobilePage from './MobilePage'

describe('MobilePage pairing connection mode', () => {
  const getPairingQR = vi.fn()
  const listNetworkInterfaces = vi.fn()

  beforeEach(() => {
    getPairingQR.mockReset().mockResolvedValue({
      available: true,
      qrDataUrl: 'data:image/png;base64,qr',
      qrSize: 218,
      pairingUrl: 'orca://pair#automatic'
    })
    listNetworkInterfaces.mockReset().mockResolvedValue({ interfaces: [] })
    mocks.storeState = {
      closeMobilePage: vi.fn(),
      orcaProfileAuthStatus: { state: 'connected' },
      settings: { showMobileButton: true },
      updateSettings: vi.fn().mockResolvedValue(undefined),
      fetchOrcaProfileAuthStatus: vi.fn().mockResolvedValue(null)
    }
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        mobile: {
          getPairingQR,
          listDevices: vi.fn().mockResolvedValue({ devices: [] }),
          listNetworkInterfaces
        },
        shell: { openUrl: vi.fn() },
        ui: { writeClipboardText: vi.fn().mockResolvedValue(undefined) }
      }
    })
  })

  afterEach(cleanup)

  async function openPairingStep(): Promise<void> {
    const user = userEvent.setup()
    render(<MobilePage />)
    await waitFor(() => expect(screen.getByTestId('stage')).toHaveTextContent('intro'))
    await user.click(screen.getByRole('button', { name: 'Enter flow' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
  }

  it('does not open unapproved Android troubleshooting in the system browser', async () => {
    const user = userEvent.setup()
    render(<MobilePage />)

    await user.click(screen.getByRole('button', { name: 'Open Android install guide' }))

    expect(window.api.shell.openUrl).not.toHaveBeenCalled()
  })

  it('restores a saved custom address for future pairing codes', async () => {
    mocks.storeState.settings = {
      showMobileButton: true,
      mobilePairingCustomAddress: '100.126.117.25:6768'
    }
    await openPairingStep()

    await waitFor(() =>
      expect(getPairingQR).toHaveBeenCalledWith({
        address: '100.126.117.25:6768'
      })
    )
    expect(screen.getByTestId('selected-address')).toHaveTextContent('100.126.117.25:6768')
    expect(screen.getByTestId('selected-address-is-custom')).toHaveTextContent('true')
    expect(screen.getByTestId('custom-addresses')).toHaveTextContent('100.126.117.25:6768')
  })

  it('keeps the copy fallback when the real encoder cannot render the offer', async () => {
    getPairingQR.mockResolvedValue({
      available: true,
      qrDataUrl: null,
      qrError: 'encoding_failed',
      pairingUrl: 'orca://pair?code=copy-fallback',
      endpoint: 'wss://host.example/large'
    })

    await openPairingStep()

    await waitFor(() => expect(screen.getByTestId('pairing-qr-error')).toHaveTextContent('true'))
    expect(screen.getByTestId('pairing-qr')).toHaveTextContent('none')
    expect(screen.getByTestId('pairing-url')).toHaveTextContent('copy-fallback')
  })

  it('copies the canonical pairing scheme when a provider returns legacy Orca', async () => {
    const user = userEvent.setup()
    await openPairingStep()
    await waitFor(() => expect(screen.getByTestId('pairing-url')).toHaveTextContent('automatic'))

    await user.click(screen.getByRole('button', { name: 'Copy pairing code' }))

    expect(window.api.ui.writeClipboardText).toHaveBeenCalledWith(
      `${PRIMARY_PAIRING_SCHEME}://pair#automatic`
    )
  })

  it('does not commit a custom direct address when its QR preflight fails', async () => {
    const user = userEvent.setup()
    await openPairingStep()
    await waitFor(() => expect(getPairingQR).toHaveBeenCalledTimes(1))
    getPairingQR.mockResolvedValueOnce({
      available: true,
      qrDataUrl: null,
      qrError: 'encoding_failed',
      pairingUrl: 'orca://pair?code=copy-fallback',
      endpoint: 'wss://custom.example/large'
    })

    await user.click(screen.getByRole('button', { name: 'Confirm custom address' }))

    await waitFor(() =>
      expect(getPairingQR).toHaveBeenLastCalledWith({
        address: 'wss://custom.example/large'
      })
    )
    expect(getPairingQR).toHaveBeenCalledTimes(2)
    expect(mocks.storeState.updateSettings).not.toHaveBeenCalledWith({
      mobilePairingCustomAddress: 'wss://custom.example/large',
      mobilePairingCustomAddresses: ['wss://custom.example/large']
    })
  })

  it('persists a custom address after its QR preflight succeeds', async () => {
    const user = userEvent.setup()
    await openPairingStep()
    await waitFor(() => expect(getPairingQR).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('button', { name: 'Confirm custom address' }))

    await waitFor(() =>
      expect(mocks.storeState.updateSettings).toHaveBeenCalledWith({
        mobilePairingCustomAddress: 'wss://custom.example/large',
        mobilePairingCustomAddresses: ['wss://custom.example/large']
      })
    )
    expect(screen.getByTestId('custom-addresses')).toHaveTextContent('wss://custom.example/large')
  })

  it('removes the active custom address and remints with a discovered fallback', async () => {
    mocks.storeState.settings = {
      showMobileButton: true,
      mobilePairingCustomAddress: 'wss://custom.example/large',
      mobilePairingCustomAddresses: ['wss://custom.example/large', 'second.example:6768']
    }
    listNetworkInterfaces.mockResolvedValue({
      interfaces: [{ name: 'Ethernet', address: '10.0.0.2' }]
    })
    const user = userEvent.setup()
    await openPairingStep()
    await waitFor(() =>
      expect(screen.getByTestId('selected-address')).toHaveTextContent('wss://custom.example/large')
    )

    await user.click(screen.getByRole('button', { name: 'Remove custom address' }))

    expect(mocks.storeState.updateSettings).toHaveBeenCalledWith({
      mobilePairingCustomAddress: null,
      mobilePairingCustomAddresses: ['second.example:6768']
    })
    expect(screen.getByTestId('selected-address')).toHaveTextContent('10.0.0.2')
    expect(screen.getByTestId('selected-address-is-custom')).toHaveTextContent('false')
    await waitFor(() =>
      expect(getPairingQR).toHaveBeenLastCalledWith({
        address: '10.0.0.2',
        rotate: true
      })
    )
  })

  it('keeps custom intent when the saved address is also discovered', async () => {
    mocks.storeState.settings = {
      showMobileButton: true,
      mobilePairingCustomAddress: '10.0.0.2',
      mobilePairingCustomAddresses: ['10.0.0.2']
    }
    listNetworkInterfaces.mockResolvedValue({
      interfaces: [{ name: 'Ethernet', address: '10.0.0.2' }]
    })

    await openPairingStep()

    expect(screen.getByTestId('selected-address')).toHaveTextContent('10.0.0.2')
    expect(screen.getByTestId('selected-address-is-custom')).toHaveTextContent('true')
  })

  it('keeps a custom address when an older network refresh resolves', async () => {
    let resolveRefresh: ((value: Record<string, unknown>) => void) | undefined
    listNetworkInterfaces.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve
        })
    )
    const user = userEvent.setup()
    render(<MobilePage />)
    await waitFor(() => expect(screen.getByTestId('stage')).toHaveTextContent('intro'))
    await user.click(screen.getByRole('button', { name: 'Enter flow' }))
    await waitFor(() => expect(listNetworkInterfaces).toHaveBeenCalledOnce())
    expect(screen.getByTestId('refreshing-addresses')).toHaveTextContent('true')

    await user.click(screen.getByRole('button', { name: 'Confirm custom address' }))
    await waitFor(() =>
      expect(screen.getByTestId('selected-address')).toHaveTextContent('wss://custom.example/large')
    )
    expect(listNetworkInterfaces).toHaveBeenCalledOnce()

    resolveRefresh?.({ interfaces: [{ name: 'Ethernet', address: '10.0.0.2' }] })

    await waitFor(() =>
      expect(screen.getByTestId('refreshing-addresses')).toHaveTextContent('false')
    )
    expect(screen.getByTestId('selected-address')).toHaveTextContent('wss://custom.example/large')
    expect(getPairingQR).not.toHaveBeenCalledWith({
      address: '10.0.0.2',
      rotate: true
    })
  })
})
