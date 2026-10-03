// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeAccessGrant } from '../../../../shared/runtime-access-grants'

const mocks = vi.hoisted(() => ({
  listNetworkInterfaces: vi.fn(),
  listRuntimeAccessGrants: vi.fn(),
  getRuntimePairingUrl: vi.fn(),
  revokeRuntimeAccess: vi.fn()
}))

vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('./RuntimeAccessGrantList', () => ({
  RuntimeAccessGrantList: ({
    error,
    grants,
    currentGrantId,
    onRevoke
  }: {
    error: boolean
    grants: RuntimeAccessGrant[]
    currentGrantId: string | null
    onRevoke: (grant: RuntimeAccessGrant) => void
  }) => (
    <div>
      <div>Grant load error: {String(error)}</div>
      <output data-testid="current-grant">{currentGrantId}</output>
      {grants.map((grant) => (
        <button key={grant.deviceId} onClick={() => onRevoke(grant)}>
          Revoke {grant.deviceId}
        </button>
      ))}
    </div>
  )
}))
vi.mock('./RuntimePairingGeneratorForm', () => ({
  RuntimePairingGeneratorForm: (props: {
    selectedAddress: string
    webClientUrl: string | null
    runtimePairingUrl: string | null
    onGenerate: () => void
  }) => (
    <div>
      <div data-testid="selected-address">{props.selectedAddress}</div>
      <output data-testid="web-url">{props.webClientUrl}</output>
      <output data-testid="pairing-url">{props.runtimePairingUrl}</output>
      <button type="button" onClick={props.onGenerate}>
        Generate
      </button>
    </div>
  )
}))

import { RuntimePairingUrlGenerator } from './RuntimePairingUrlGenerator'
import { runtimePairingLinkCache } from './runtime-pairing-link-state'

describe('RuntimePairingUrlGenerator', () => {
  beforeEach(() => {
    runtimePairingLinkCache.selectedAddress = '100.76.32.125'
    runtimePairingLinkCache.customAddress = ''
    runtimePairingLinkCache.intent = 'another'
    runtimePairingLinkCache.generatedAddress = null
    runtimePairingLinkCache.runtimePairingUrl = null
    runtimePairingLinkCache.webClientUrl = null
    runtimePairingLinkCache.runtimePairingDeviceId = null
    mocks.listNetworkInterfaces.mockReset()
    mocks.listRuntimeAccessGrants.mockReset().mockResolvedValue({ grants: [] })
    mocks.revokeRuntimeAccess.mockReset().mockResolvedValue({ revoked: true })
    mocks.getRuntimePairingUrl.mockReset().mockResolvedValue({
      available: true,
      pairingUrl: 'orca://pair#runtime',
      webClientUrl: 'http://127.0.0.1:6768/web-index.html?pairing=runtime',
      endpoint: 'ws://127.0.0.1:6768',
      deviceId: 'runtime-1'
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        mobile: {
          listNetworkInterfaces: mocks.listNetworkInterfaces,
          listRuntimeAccessGrants: mocks.listRuntimeAccessGrants,
          getRuntimePairingUrl: mocks.getRuntimePairingUrl,
          revokeRuntimeAccess: mocks.revokeRuntimeAccess
        }
      }
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('keeps the cached address while interfaces are loading', async () => {
    let resolveInterfaces!: (value: { interfaces: { name: string; address: string }[] }) => void
    mocks.listNetworkInterfaces.mockReturnValue(
      new Promise((resolve) => {
        resolveInterfaces = resolve
      })
    )

    render(<RuntimePairingUrlGenerator />)
    await waitFor(() => expect(mocks.listNetworkInterfaces).toHaveBeenCalledOnce())
    expect(screen.getByTestId('selected-address')).toHaveTextContent('100.76.32.125')

    resolveInterfaces({
      interfaces: [{ name: 'tailscale0', address: '100.76.32.125' }]
    })
    await waitFor(() =>
      expect(screen.getByTestId('selected-address')).toHaveTextContent('100.76.32.125')
    )
  })
  it('loads access grants on activation without loading the generator network choices', async () => {
    const { rerender } = render(
      <RuntimePairingUrlGenerator showGeneratorForm={false} active={false} />
    )
    expect(mocks.listRuntimeAccessGrants).not.toHaveBeenCalled()
    expect(mocks.listNetworkInterfaces).not.toHaveBeenCalled()
    rerender(<RuntimePairingUrlGenerator showGeneratorForm={false} active />)
    await waitFor(() => expect(mocks.listRuntimeAccessGrants).toHaveBeenCalledTimes(1))
    rerender(<RuntimePairingUrlGenerator showGeneratorForm={false} active={false} />)
    rerender(<RuntimePairingUrlGenerator showGeneratorForm={false} active />)
    await waitFor(() => expect(mocks.listRuntimeAccessGrants).toHaveBeenCalledTimes(2))
  })
  it('leaves grant management out of the generation surface', async () => {
    render(<RuntimePairingUrlGenerator showAccessList={false} />)
    await waitFor(() => expect(mocks.listNetworkInterfaces).toHaveBeenCalledOnce())
    expect(mocks.listRuntimeAccessGrants).not.toHaveBeenCalled()
    expect(screen.queryByText('Grant load error: false')).not.toBeInTheDocument()
  })
  it('reports a failed access load instead of showing an empty directory', async () => {
    mocks.listRuntimeAccessGrants.mockRejectedValueOnce(new Error('offline'))
    render(<RuntimePairingUrlGenerator showGeneratorForm={false} />)
    await screen.findByText('Grant load error: true')
  })

  it('clears generated links across mounted surfaces and navigation after revocation', async () => {
    const grant: RuntimeAccessGrant = {
      deviceId: 'runtime-1',
      name: 'Browser',
      createdAt: 1,
      lastSeenAt: null
    }
    mocks.listNetworkInterfaces.mockResolvedValue({ interfaces: [] })
    const surfaces = (accessActive: boolean) => (
      <>
        <RuntimePairingUrlGenerator showAccessList={false} />
        <RuntimePairingUrlGenerator showGeneratorForm={false} active={accessActive} />
      </>
    )
    const { rerender, unmount } = render(surfaces(true))
    await waitFor(() => expect(mocks.listRuntimeAccessGrants).toHaveBeenCalledOnce())
    mocks.listRuntimeAccessGrants.mockResolvedValue({ grants: [grant] })
    await act(async () => screen.getByRole('button', { name: 'Generate' }).click())
    expect(screen.getByTestId('web-url')).not.toBeEmptyDOMElement()
    rerender(surfaces(false))
    rerender(surfaces(true))
    const revoke = await screen.findByRole('button', { name: 'Revoke runtime-1' })
    await act(async () => revoke.click())
    expect(screen.getByTestId('web-url')).toBeEmptyDOMElement()
    expect(screen.getByTestId('pairing-url')).toBeEmptyDOMElement()
    expect(screen.getByTestId('current-grant')).toBeEmptyDOMElement()
    unmount()
    render(<RuntimePairingUrlGenerator showAccessList={false} />)
    expect(screen.getByTestId('web-url')).toBeEmptyDOMElement()
  })

  it('preserves a new link while revocation of an older grant is pending', async () => {
    const grant: RuntimeAccessGrant = {
      deviceId: 'runtime-1',
      name: 'Browser',
      createdAt: 1,
      lastSeenAt: null
    }
    mocks.listNetworkInterfaces.mockResolvedValue({ interfaces: [] })
    mocks.listRuntimeAccessGrants.mockResolvedValue({ grants: [grant] })
    render(
      <>
        <RuntimePairingUrlGenerator showAccessList={false} />
        <RuntimePairingUrlGenerator showGeneratorForm={false} />
      </>
    )
    await act(async () => screen.getByRole('button', { name: 'Generate' }).click())
    expect(screen.getByTestId('current-grant')).toHaveTextContent('runtime-1')
    let complete!: (result: { revoked: boolean }) => void
    mocks.revokeRuntimeAccess.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve
        })
    )
    await act(async () => screen.getByRole('button', { name: 'Revoke runtime-1' }).click())
    mocks.getRuntimePairingUrl.mockResolvedValueOnce({
      available: true,
      deviceId: 'runtime-2',
      pairingUrl: 'orca://pair#new',
      webClientUrl: 'http://127.0.0.1/web?pairing=new'
    })
    await act(async () => screen.getByRole('button', { name: 'Generate' }).click())
    await act(async () => complete({ revoked: true }))
    expect(screen.getByTestId('web-url')).toHaveTextContent('pairing=new')
    expect(screen.getByTestId('current-grant')).toHaveTextContent('runtime-2')
  })

  // Why: the main process gates the one-way network widen on the declared reach, so dropping it (as the
  // component used to) leaves main guessing from the address string — "This computer only" then widened,
  // and a Custom loopback tunnel front-end would not.
  it.each([
    ['local' as const, '127.0.0.1', 'this-computer'],
    ['another' as const, '100.76.32.125', 'network'],
    ['custom' as const, '127.0.0.1:8443', 'network']
  ])('sends the %s reach with the address', async (intent, address, reach) => {
    runtimePairingLinkCache.intent = intent
    runtimePairingLinkCache.selectedAddress = address
    mocks.listNetworkInterfaces.mockResolvedValue({
      interfaces: [{ name: 'tailscale0', address: '100.76.32.125' }]
    })

    render(<RuntimePairingUrlGenerator />)
    await waitFor(() => expect(mocks.listNetworkInterfaces).toHaveBeenCalledOnce())

    screen.getByRole('button', { name: 'Generate' }).click()

    await waitFor(() =>
      expect(mocks.getRuntimePairingUrl).toHaveBeenCalledWith({ address, rotate: true, reach })
    )
  })
})
