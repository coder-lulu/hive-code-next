// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as I18nModule from '@/i18n/i18n'
import type { HiveAccountState } from '../../../../shared/hive-account'
import type {
  HiveAccountRuntimeDirectoryState,
  HiveLocalRuntimeOwnershipState
} from '../../../../shared/hive-runtime-cloud'
import {
  EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY,
  EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP
} from '../../../../shared/hive-runtime-cloud'
import { _resetPairedMobileDevicesCacheForTests } from '../mobile/paired-mobile-devices'
import { TooltipProvider } from '@/components/ui/tooltip'
import DeviceConnectionsPage from './DeviceConnectionsPage'
import { DeviceConnectionsPane } from '../settings/DeviceConnectionsPane'
import type { GlobalSettings } from '../../../../shared/global-settings-types'

const mocks = vi.hoisted(() => ({
  state: {} as {
    settings: GlobalSettings
    deviceConnectionsRequest: { tab: 'hosts' | 'this-computer' | 'access'; revision: number }
    setActiveRuntimeEnvironmentPreference: (id: string | null) => Promise<boolean>
    accountRuntimeDirectory: HiveAccountRuntimeDirectoryState
    localRuntimeOwnership: HiveLocalRuntimeOwnershipState
    settingsSearchQuery: string
    updateSettings: ReturnType<typeof vi.fn>
    recordFeatureInteraction: ReturnType<typeof vi.fn>
    closeDeviceConnectionsPage: ReturnType<typeof vi.fn>
    openDeviceConnectionsPage: ReturnType<typeof vi.fn>
    openSettingsPage: ReturnType<typeof vi.fn>
    openSettingsTarget: ReturnType<typeof vi.fn>
    refreshAccountRuntimeCloud: ReturnType<typeof vi.fn>
    claimLocalRuntimeForAccount: ReturnType<typeof vi.fn>
  },
  getState: vi.fn(),
  getPairingQR: vi.fn(),
  refresh: vi.fn(),
  listDevices: vi.fn(),
  revokeDevice: vi.fn(),
  accountListener: null as ((state: HiveAccountState) => void) | null
}))
vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
    { getState: () => mocks.state }
  )
}))
vi.mock('@/i18n/i18n', async () => ({
  ...(await vi.importActual<typeof I18nModule>('@/i18n/i18n')),
  translate: (_key: string, fallback: string, params?: Record<string, string>) =>
    params ? fallback.replace('{{name}}', params.name ?? '') : fallback,
  getIntlLocale: () => 'en'
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
// This page supplies the account pane's content through its children.
vi.mock('../settings/HiveAccountSettingsContent', () => ({
  HiveAccountSettingsContent: () => null
}))
vi.mock('../settings/RuntimeEnvironmentsPane', () => ({
  RuntimeEnvironmentsPane: () => <div>Saved host directory</div>
}))
vi.mock('../settings/SshPane', async () => {
  const { useState } = await import('react')
  const { useSshAddTargetIntent } = await import('../settings/use-ssh-add-target-intent')
  return {
    SshPane: ({ addTargetIntentSignal }: { addTargetIntentSignal?: number }) => {
      const [open, setOpen] = useState(false)
      useSshAddTargetIntent(addTargetIntentSignal, () => setOpen(true))
      return (
        <div>
          SSH add intent {addTargetIntentSignal}
          {open ? (
            <div role="dialog">
              <button onClick={() => setOpen(false)}>Dismiss SSH form</button>
            </div>
          ) : null}
        </div>
      )
    }
  }
})

const signedOut: HiveAccountState = { configured: true, status: 'signed-out', persistence: 'none' }
function mountPage() {
  return render(
    <TooltipProvider>
      <DeviceConnectionsPage />
    </TooltipProvider>
  )
}

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  _resetPairedMobileDevicesCacheForTests()
  vi.clearAllMocks()
  mocks.state = {
    settings: {} as GlobalSettings,
    deviceConnectionsRequest: { tab: 'this-computer', revision: 0 },
    setActiveRuntimeEnvironmentPreference: vi.fn().mockResolvedValue(true),
    settingsSearchQuery: '',
    accountRuntimeDirectory: EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY,
    localRuntimeOwnership: EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP,
    updateSettings: vi.fn().mockResolvedValue(undefined),
    recordFeatureInteraction: vi.fn(),
    closeDeviceConnectionsPage: vi.fn(),
    openDeviceConnectionsPage: vi.fn(),
    openSettingsPage: vi.fn(),
    openSettingsTarget: vi.fn(),
    refreshAccountRuntimeCloud: vi.fn().mockResolvedValue(undefined),
    claimLocalRuntimeForAccount: vi.fn()
  }
  mocks.getState.mockResolvedValue(signedOut)
  mocks.refresh.mockResolvedValue({ status: 'refreshed', state: signedOut })
  mocks.listDevices.mockResolvedValue({ devices: [] })
  mocks.revokeDevice.mockResolvedValue({ revoked: true })
  mocks.getPairingQR.mockResolvedValue({
    available: true,
    qrDataUrl: 'data:image/png;base64,qr',
    qrSize: 192,
    pairingUrl: 'hivecode://pair?token=test',
    endpoint: 'ws://192.168.1.10:6767'
  })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      hiveAccount: {
        getState: mocks.getState,
        onStateChanged: (listener: (state: HiveAccountState) => void) => {
          mocks.accountListener = listener
          return () => {
            mocks.accountListener = null
          }
        },
        getLoginCapabilities: vi.fn().mockResolvedValue({ providers: [] }),
        refresh: mocks.refresh
      },
      hiveRuntimeCloud: {
        listSessions: vi.fn().mockResolvedValue({ items: [], nextCursor: null })
      },
      mobile: {
        listNetworkInterfaces: vi
          .fn()
          .mockResolvedValue({ interfaces: [{ name: 'Wi-Fi', address: '192.168.1.10' }] }),
        getPairingQR: mocks.getPairingQR,
        listDevices: mocks.listDevices,
        revokeDevice: mocks.revokeDevice,
        listRuntimeAccessGrants: vi.fn().mockResolvedValue({ grants: [] }),
        getWindowsFirewallStatus: vi.fn().mockResolvedValue({ supported: false })
      },
      ui: { writeClipboardText: vi.fn().mockResolvedValue(undefined) },
      shell: { openUrl: vi.fn() }
    }
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
  _resetPairedMobileDevicesCacheForTests()
})

describe('Devices & connections', () => {
  it('defaults to account access and pairs directly while signed out, retaining the QR across tab changes', async () => {
    const user = userEvent.setup()
    mountPage()
    expect(screen.getByRole('tab', { name: 'HiveCloud account' })).toHaveAttribute(
      'data-state',
      'active'
    )
    await screen.findByRole('button', { name: 'Sign in to HiveCloud' })
    expect(mocks.getPairingQR).not.toHaveBeenCalled()
    await user.click(screen.getByRole('tab', { name: 'Direct address' }))
    await user.click(await screen.findByRole('button', { name: 'Generate QR code' }))
    await screen.findByRole('img', { name: 'QR Code for mobile pairing' })
    expect(mocks.getPairingQR).toHaveBeenCalledWith({ address: '192.168.1.10' })
    await user.click(screen.getByRole('tab', { name: 'My hosts' }))
    expect(
      screen.queryByRole('img', { name: 'QR Code for mobile pairing' })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Connect to this computer' }))
    await user.click(screen.getByRole('tab', { name: 'HiveCloud account' }))
    await user.click(screen.getByRole('tab', { name: 'Direct address' }))
    expect(screen.getByRole('img', { name: 'QR Code for mobile pairing' })).toBeInTheDocument()
    expect(mocks.getPairingQR).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Copy pairing code' }))
    expect(window.api.ui.writeClipboardText).toHaveBeenCalledWith('hivecode://pair?token=test')
  })
  it('opens the shared login dialog and Escape dismisses it without closing the page', async () => {
    const user = userEvent.setup()
    mountPage()
    await user.click(await screen.findByRole('button', { name: 'Sign in to HiveCloud' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.state.closeDeviceConnectionsPage).not.toHaveBeenCalled()
  })
  it('opens the requested settings area directly and forwards SSH add intents', async () => {
    const props = {
      settings: mocks.state.settings,
      setActiveRuntimeEnvironmentPreference: mocks.state.setActiveRuntimeEnvironmentPreference
    }
    const { rerender } = render(
      <DeviceConnectionsPane {...props} requestedSectionId="devices-access" />,
      { wrapper: TooltipProvider }
    )
    expect(screen.getByRole('tab', { name: 'Access management' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await screen.findByText('Shared Server Access')
    expect(mocks.state.openDeviceConnectionsPage).not.toHaveBeenCalled()
    rerender(
      <DeviceConnectionsPane
        {...props}
        requestedSectionId="devices-ssh"
        sshHostAddIntentSignal={2}
      />
    )
    expect(screen.getByRole('tab', { name: 'My hosts' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('SSH add intent 2')).toBeInTheDocument()
  })
  it('keeps the host directory as the default settings area and the only web area', () => {
    render(
      <DeviceConnectionsPane
        settings={mocks.state.settings}
        setActiveRuntimeEnvironmentPreference={mocks.state.setActiveRuntimeEnvironmentPreference}
        initialTab="access"
        isWebClient
      />
    )
    expect(screen.getByRole('tab', { name: 'My hosts' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByRole('tab')).toHaveLength(1)
    expect(screen.getByText('Saved host directory')).toBeInTheDocument()
  })
  it.each(['flag', 'path'])(
    'restricts the standalone web page detected by %s to hosts',
    async (detection) => {
      if (detection === 'flag') {
        vi.stubGlobal('__ORCA_WEB_CLIENT__', true)
      } else {
        window.history.replaceState(null, '', '/web-index.html')
      }
      mocks.getState.mockResolvedValue({
        configured: false,
        status: 'unconfigured',
        persistence: 'none'
      })
      mountPage()
      expect(screen.getAllByRole('tab')).toHaveLength(1)
      expect(screen.getByRole('tab', { name: 'My hosts' })).toHaveAttribute('aria-selected', 'true')
      expect(screen.queryByRole('button', { name: 'SSH Hosts' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Account settings' })).not.toBeInTheDocument()
      expect(screen.getByText('Saved host directory')).toBeInTheDocument()
      await waitFor(() => expect(mocks.getState).toHaveBeenCalled())
      expect(window.api.mobile.listNetworkInterfaces).not.toHaveBeenCalled()
      expect(window.api.mobile.listRuntimeAccessGrants).not.toHaveBeenCalled()
      expect(mocks.listDevices).not.toHaveBeenCalled()
    }
  )
  it('consumes an SSH add request once across collapse and accepts the next request', async () => {
    const props = {
      settings: mocks.state.settings,
      setActiveRuntimeEnvironmentPreference: mocks.state.setActiveRuntimeEnvironmentPreference
    }
    const { rerender } = render(
      <DeviceConnectionsPane
        {...props}
        requestedSectionId="devices-ssh"
        sshHostAddIntentSignal={1}
      />,
      { wrapper: TooltipProvider }
    )
    const user = userEvent.setup()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Dismiss SSH form' }))
    await user.click(screen.getByRole('button', { name: 'SSH Hosts' }))
    expect(screen.getByRole('button', { name: 'SSH Hosts' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    await user.click(screen.getByRole('button', { name: 'SSH Hosts' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    rerender(
      <DeviceConnectionsPane
        {...props}
        requestedSectionId="devices-ssh"
        sshHostAddIntentSignal={2}
      />
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
  it('reveals the direct pairing and SSH areas when settings search matches them', () => {
    const props = {
      settings: mocks.state.settings,
      setActiveRuntimeEnvironmentPreference: mocks.state.setActiveRuntimeEnvironmentPreference
    }
    const { rerender } = render(<DeviceConnectionsPane {...props} searchQuery="QR" />, {
      wrapper: TooltipProvider
    })
    expect(screen.getByRole('tab', { name: 'Connect to this computer' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByRole('tab', { name: 'Direct address' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    rerender(<DeviceConnectionsPane {...props} searchQuery="SSH" />)
    expect(screen.getByRole('tab', { name: 'My hosts' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'SSH Hosts' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  })
  it('refreshes failed device loading and prevents a duplicate revoke while it is pending', async () => {
    mocks.listDevices.mockRejectedValueOnce(new Error('offline'))
    mocks.state.deviceConnectionsRequest.tab = 'access'
    mountPage()
    await screen.findByText('Authorized devices could not be loaded.')
    mocks.listDevices.mockResolvedValue({
      devices: [{ deviceId: 'phone-1', name: 'My phone', pairedAt: 1, lastSeenAt: 2 }]
    })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText('My phone')
    let complete!: (result: { revoked: boolean }) => void
    mocks.revokeDevice.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve
      })
    )
    const revoke = screen.getByRole('button', { name: 'Revoke My phone' })
    await user.click(revoke)
    expect(revoke).toBeDisabled()
    await user.click(revoke)
    expect(mocks.revokeDevice).toHaveBeenCalledTimes(1)
    mocks.listDevices.mockResolvedValue({ devices: [] })
    await act(async () => complete({ revoked: true }))
    await waitFor(() => expect(screen.queryByText('My phone')).not.toBeInTheDocument())
  })
})
