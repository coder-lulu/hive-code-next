import { afterEach, describe, expect, it, vi } from 'vitest'
import { startPreProfilePairing } from './pre-profile-pairing-coordinator'
import { FakeSession } from './mobile-endpoint-supervisor-test-fakes'
import type { connect } from './rpc-client'
import type { HostProfile, PairingOffer, RpcResponse } from './types'

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('expo-secure-store', () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED' }))
const now = Date.UTC(2026, 6, 13)
const offer: PairingOffer = {
  v: 2,
  endpoint: 'ws://192.168.1.10:6768',
  deviceToken: 'phone-credential',
  publicKeyB64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
}
const runtimeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
function success(result: unknown): RpcResponse {
  return { id: 'rpc-1', ok: true, result, _meta: { runtimeId } }
}
function setup(response: RpcResponse = success({ version: '1.0.0' })) {
  const events: string[] = []
  const client = new FakeSession('connected')
  client.sendRequest.mockResolvedValue(response)
  const dependencies = {
    connectDirect: vi.fn((..._args: Parameters<typeof connect>) => {
      events.push('connect')
      return client
    }),
    resolveHostIdentity: vi.fn(async (_key: string, id: string) => ({ id, name: 'Blue Whale' })),
    savePairedHost: vi.fn(async (_host: HostProfile) => {
      events.push('save-host')
    }),
    recordDescriptorFromStatus: vi.fn((_hostId: string, _status: unknown) => {
      events.push('record-descriptor')
    }),
    now: () => now
  }
  const start = (pairingOffer = offer) =>
    startPreProfilePairing({ offer: pairingOffer, timeoutMs: 5_000, dependencies })
  return { client, dependencies, events, start }
}
afterEach(() => vi.useRealTimers())
describe('pre-profile authenticated direct pairing', () => {
  it('connects only the scanned endpoint and saves its authenticated credentials before descriptor upkeep', async () => {
    const ctx = setup(
      success({ machineName: 'Studio Mac', hostPlatform: 'darwin', runtimeRecordId: runtimeId })
    )
    await expect(ctx.start().result).resolves.toEqual({ hostId: 'host-' + now })
    expect(ctx.dependencies.connectDirect).toHaveBeenCalledExactlyOnceWith(
      offer.endpoint,
      offer.deviceToken,
      offer.publicKeyB64,
      undefined
    )
    expect(ctx.client.sendRequest).toHaveBeenCalledExactlyOnceWith('status.get')
    expect(ctx.dependencies.savePairedHost).toHaveBeenCalledExactlyOnceWith({
      id: 'host-' + now,
      name: 'Blue Whale',
      endpoint: offer.endpoint,
      deviceToken: offer.deviceToken,
      publicKeyB64: offer.publicKeyB64,
      lastConnected: now,
      runtimeRecordId: runtimeId
    })
    expect(ctx.events).toEqual(['connect', 'save-host', 'record-descriptor'])
    expect(ctx.dependencies.recordDescriptorFromStatus).toHaveBeenCalledWith(
      'host-' + now,
      expect.objectContaining({ machineName: 'Studio Mac', hostPlatform: 'darwin' })
    )
    expect(ctx.client.close).toHaveBeenCalledOnce()
  })
  it('reuses the saved host id and phone name for the same pinned desktop key', async () => {
    const ctx = setup()
    ctx.dependencies.resolveHostIdentity.mockImplementation(async (key, fallback) => {
      expect(key).toBe(offer.publicKeyB64)
      expect(fallback).toBe('host-' + now)
      return { id: 'existing-host', name: 'Studio Mac' }
    })
    await expect(ctx.start().result).resolves.toEqual({ hostId: 'existing-host' })
    expect(ctx.dependencies.savePairedHost).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'existing-host', name: 'Studio Mac' })
    )
  })
  it('pairs an authenticated unreadable successful status without recording a descriptor or trusting offered Runtime metadata', async () => {
    const ctx = setup(success(null))
    await expect(ctx.start({ ...offer, runtimeRecordId: runtimeId }).result).resolves.toEqual({
      hostId: 'host-' + now
    })
    expect(ctx.dependencies.savePairedHost).toHaveBeenCalledWith(
      expect.objectContaining({ runtimeRecordId: undefined })
    )
    expect(ctx.dependencies.recordDescriptorFromStatus).not.toHaveBeenCalled()
  })
  it('does not fail a saved pairing when descriptor upkeep throws', async () => {
    const ctx = setup()
    ctx.dependencies.recordDescriptorFromStatus.mockImplementation(() => {
      throw new Error('storage unavailable')
    })
    await expect(ctx.start().result).resolves.toEqual({ hostId: 'host-' + now })
    expect(ctx.dependencies.savePairedHost).toHaveBeenCalledOnce()
    expect(ctx.client.close).toHaveBeenCalledOnce()
  })
  it.each(['method_not_found', 'scope_refused', 'unauthorized'])(
    'does not publish refused status %s',
    async (code) => {
      const ctx = setup({ id: 'rpc-1', ok: false, error: { code, message: code } })
      await expect(ctx.start().result).rejects.toThrow()
      expect(ctx.dependencies.savePairedHost).not.toHaveBeenCalled()
      expect(ctx.dependencies.recordDescriptorFromStatus).not.toHaveBeenCalled()
      expect(ctx.client.close).toHaveBeenCalledOnce()
    }
  )
  it.each([7, 'invalid-runtime-id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'])(
    'rejects invalid or conflicting authenticated identity %s',
    async (runtimeRecordId) => {
      const ctx = setup(success({ runtimeRecordId }))
      await expect(ctx.start({ ...offer, runtimeRecordId: runtimeId }).result).rejects.toThrow(
        /Runtime/
      )
      expect(ctx.dependencies.savePairedHost).not.toHaveBeenCalled()
      expect(ctx.client.close).toHaveBeenCalledOnce()
    }
  )
  it('never trusts an offered Runtime id when authenticated status does not report one', async () => {
    const ctx = setup()
    await ctx.start({ ...offer, runtimeRecordId: runtimeId }).result
    expect(ctx.dependencies.savePairedHost).toHaveBeenCalledWith(
      expect.objectContaining({ runtimeRecordId: undefined })
    )
  })
  it('cancels a pending status probe without publishing late success', async () => {
    const ctx = setup()
    let finish: (response: RpcResponse) => void = () => {
      throw new Error('Expected pending status')
    }
    ctx.client.sendRequest.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    const attempt = ctx.start()
    await vi.waitFor(() => expect(ctx.client.sendRequest).toHaveBeenCalledOnce())
    attempt.dispose()
    attempt.dispose()
    expect(ctx.client.close).toHaveBeenCalledOnce()
    finish(success({ runtimeRecordId: runtimeId }))
    await expect(attempt.result).rejects.toThrow(/cancel/)
    expect(ctx.dependencies.savePairedHost).not.toHaveBeenCalled()
    expect(ctx.dependencies.recordDescriptorFromStatus).not.toHaveBeenCalled()
  })
  it('does not open a client if cancellation wins the identity lookup', async () => {
    const ctx = setup()
    let finish: (value: { id: string; name: string }) => void = () => {
      throw new Error('Expected pending identity')
    }
    ctx.dependencies.resolveHostIdentity.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    const attempt = ctx.start()
    attempt.dispose()
    finish({ id: 'existing-host', name: 'Studio Mac' })
    await expect(attempt.result).rejects.toThrow(/cancel/)
    expect(ctx.dependencies.connectDirect).not.toHaveBeenCalled()
    expect(ctx.dependencies.savePairedHost).not.toHaveBeenCalled()
  })
  it('closes a timed-out candidate and refuses its late status', async () => {
    vi.useFakeTimers()
    const ctx = setup()
    let finish: (response: RpcResponse) => void = () => {
      throw new Error('Expected pending status')
    }
    ctx.client.sendRequest.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    const attempt = ctx.start()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(attempt.timedOut).toBe(true)
    expect(ctx.client.close).toHaveBeenCalledOnce()
    finish(success({}))
    await expect(attempt.result).rejects.toThrow('mobile pairing timed out')
    expect(ctx.dependencies.savePairedHost).not.toHaveBeenCalled()
  })
  it('propagates failed credential persistence and closes the disposable client', async () => {
    const ctx = setup()
    ctx.dependencies.savePairedHost.mockRejectedValueOnce(new Error('credential store unavailable'))
    await expect(ctx.start().result).rejects.toThrow('credential store unavailable')
    expect(ctx.dependencies.recordDescriptorFromStatus).not.toHaveBeenCalled()
    expect(ctx.client.close).toHaveBeenCalledOnce()
  })
})
