import { beforeEach, expect, it, vi } from 'vitest'
import {
  encodePairingOffer,
  PAIRING_OFFER_VERSION,
  type PairingOffer
} from '../../../src/shared/pairing'
import {
  sendRemoteRuntimeRequest,
  subscribeRemoteRuntimeRequest
} from '../../../src/shared/remote-runtime-client'
import { MOBILE_RUNTIME_CLIENT_CAPABILITIES } from '../../../mobile/src/transport/mobile-runtime-client-capabilities'
import { pairMobileClient } from './paired-mobile-client'
vi.mock('../../../src/shared/remote-runtime-client', () => ({
  sendRemoteRuntimeRequest: vi.fn(),
  subscribeRemoteRuntimeRequest: vi.fn()
}))
const offer: PairingOffer = {
  v: PAIRING_OFFER_VERSION,
  endpoint: 'ws://127.0.0.1:1234',
  deviceToken: 'phone-token',
  publicKeyB64: 'test-pinned-key',
  scope: 'mobile'
}
beforeEach(() => vi.clearAllMocks())
it('keeps the original current offer and mobile capability scope for requests', async () => {
  vi.mocked(sendRemoteRuntimeRequest).mockResolvedValue({
    id: 'r',
    ok: true,
    result: { tabs: [] },
    _meta: { runtimeId: 'runtime-test' }
  })
  const phone = pairMobileClient({ pairingUrl: encodePairingOffer(offer) })
  await expect(phone.call('session.tabs.list', { worktree: 'id:workspace' })).resolves.toEqual({
    tabs: []
  })
  expect(sendRemoteRuntimeRequest).toHaveBeenCalledWith(
    offer,
    'session.tabs.list',
    { worktree: 'id:workspace' },
    15000,
    undefined,
    undefined,
    MOBILE_RUNTIME_CLIENT_CAPABILITIES
  )
})
it('never substitutes a runtime token for a mobile token', () => {
  expect(() =>
    pairMobileClient({ pairingUrl: encodePairingOffer({ ...offer, scope: 'runtime' }) })
  ).toThrow('Expected a mobile-scoped')
  expect(sendRemoteRuntimeRequest).not.toHaveBeenCalled()
})
it('subscribes on the same owner and disposes each tracked subscription once', async () => {
  const close = vi.fn(),
    callbacks = { onResponse: vi.fn(), onError: vi.fn() }
  vi.mocked(subscribeRemoteRuntimeRequest).mockResolvedValue({
    requestId: 's',
    close,
    sendBinary: () => true
  })
  const phone = pairMobileClient({ pairingUrl: encodePairingOffer(offer) })
  await phone.subscribe('layout.subscribe', {}, callbacks)
  expect(subscribeRemoteRuntimeRequest).toHaveBeenCalledWith(
    offer,
    'layout.subscribe',
    {},
    15000,
    callbacks,
    { clientCapabilities: MOBILE_RUNTIME_CLIENT_CAPABILITIES }
  )
  phone.dispose()
  phone.dispose()
  expect(close).toHaveBeenCalledOnce()
})
