import { describe, expect, it, vi } from 'vitest'
import { startPreProfilePairing } from './pre-profile-pairing-coordinator'
import type { HostProfile, PairingOffer, RpcResponse } from './types'
import type { connect, RpcClient } from './rpc-client'

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('expo-crypto', () => ({
  getRandomBytes: (length: number) => new Uint8Array(length).fill(length)
}))
vi.mock('expo-secure-store', () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED' }))

const now = Date.UTC(2026, 6, 13)
const runtimeRecordId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const directOffer: PairingOffer = {
  v: 2,
  endpoint: 'ws://192.168.1.10:6768',
  deviceToken: 'device-token',
  publicKeyB64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
}
function success(result: unknown): RpcResponse {
  return { id: 'rpc-1', ok: true, result, _meta: { runtimeId: 'runtime-1' } }
}

function fakeClient(responses: RpcResponse[]) {
  return {
    sendRequest: vi.fn().mockImplementation(async () => responses.shift()!),
    close: vi.fn()
  } as unknown as RpcClient
}

function dependencies(client: RpcClient, events: string[]) {
  return {
    connectDirect: vi.fn(
      (..._args: Parameters<typeof connect>) => (events.push('connect'), client)
    ),
    resolveHostIdentity: vi.fn(async (_key: string, id: string) => ({ id, name: 'Blue Whale' })),
    savePairedHost: vi.fn(async (_host: HostProfile) => {
      events.push('save-host')
    }),
    recordDescriptorFromStatus: vi.fn(() => {
      events.push('record-descriptor')
    }),
    now: () => now
  }
}
describe('local pre-profile pairing', () => {
  it('keeps a legacy offer direct-only through the shared path', async () => {
    const events: string[] = []
    const client = fakeClient([success({ version: '1.0.0' })])
    const deps = dependencies(client, events)

    const attempt = startPreProfilePairing({
      offer: directOffer,
      timeoutMs: 5_000,
      dependencies: deps
    })

    await expect(attempt.result).resolves.toEqual({ hostId: `host-${now}` })
    expect(deps.savePairedHost).toHaveBeenCalledWith({
      id: `host-${now}`,
      name: 'Blue Whale',
      endpoint: directOffer.endpoint,
      deviceToken: directOffer.deviceToken,
      publicKeyB64: directOffer.publicKeyB64,
      lastConnected: now
    })
    expect(events).toEqual(['connect', 'save-host', 'record-descriptor'])
  })
  it('persists the Runtime record id proven by authenticated status', async () => {
    const client = fakeClient([success({ version: '1.0.0', runtimeRecordId })])
    const deps = dependencies(client, [])

    const attempt = startPreProfilePairing({
      offer: directOffer,
      timeoutMs: 5_000,
      dependencies: deps
    })

    await expect(attempt.result).resolves.toEqual({ hostId: `host-${now}` })
    expect(deps.savePairedHost).toHaveBeenCalledWith(expect.objectContaining({ runtimeRecordId }))
  })
  it('drops an offered Runtime record id when authenticated status does not prove it', async () => {
    const client = fakeClient([success({ version: '1.0.0' })])
    const deps = dependencies(client, [])

    const attempt = startPreProfilePairing({
      offer: { ...directOffer, runtimeRecordId },
      timeoutMs: 5_000,
      dependencies: deps
    })

    await expect(attempt.result).resolves.toEqual({ hostId: `host-${now}` })
    expect(deps.savePairedHost).toHaveBeenCalledWith(
      expect.not.objectContaining({ runtimeRecordId: expect.anything() })
    )
  })
  it('rejects when the offer and authenticated status identify different Runtimes', async () => {
    const client = fakeClient([
      success({
        version: '1.0.0',
        runtimeRecordId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      })
    ])
    const deps = dependencies(client, [])

    const attempt = startPreProfilePairing({
      offer: { ...directOffer, runtimeRecordId },
      timeoutMs: 5_000,
      dependencies: deps
    })

    await expect(attempt.result).rejects.toThrow(
      'pairing offer Runtime identity does not match the authenticated Runtime'
    )
    expect(deps.savePairedHost).not.toHaveBeenCalled()
  })
  it('reuses the existing host id and name when re-pairing the same desktop key (no duplicate)', async () => {
    // STA-1840: re-pairing a desktop already stored under a different id must
    // merge into that card, not mint a new host-${now} and duplicate the row.
    const events: string[] = []
    const client = fakeClient([success({ version: '1.0.0' })])
    const deps = dependencies(client, events)
    deps.resolveHostIdentity = vi.fn(async (publicKeyB64: string, newHostId: string) => {
      expect(publicKeyB64).toBe(directOffer.publicKeyB64)
      expect(newHostId).toBe(`host-${now}`)
      return { id: 'host-existing', name: 'Studio Mac' }
    })

    const attempt = startPreProfilePairing({
      offer: directOffer,
      timeoutMs: 5_000,
      dependencies: deps
    })

    await expect(attempt.result).resolves.toEqual({ hostId: 'host-existing' })
    expect(deps.savePairedHost).toHaveBeenCalledWith({
      id: 'host-existing',
      name: 'Studio Mac',
      endpoint: directOffer.endpoint,
      deviceToken: directOffer.deviceToken,
      publicKeyB64: directOffer.publicKeyB64,
      lastConnected: now
    })
  })

  it('records the authenticated host descriptor only after saving the host', async () => {
    const events: string[] = []
    const client = fakeClient([success({ machineName: 'Studio', hostPlatform: 'darwin' })])
    const deps = dependencies(client, events)
    const attempt = startPreProfilePairing({
      offer: directOffer,
      timeoutMs: 5_000,
      dependencies: deps
    })

    await expect(attempt.result).resolves.toEqual({ hostId: `host-${now}` })
    expect(events).toEqual(['connect', 'save-host', 'record-descriptor'])
    expect(deps.recordDescriptorFromStatus).toHaveBeenCalledWith(
      `host-${now}`,
      expect.objectContaining({ machineName: 'Studio', hostPlatform: 'darwin' })
    )
  })
  it('cancels the disposable physical client without publishing a host', async () => {
    let resolveStatus!: (response: RpcResponse) => void
    const status = new Promise<RpcResponse>((resolve) => {
      resolveStatus = resolve
    })
    const client = fakeClient([])
    ;(client.sendRequest as ReturnType<typeof vi.fn>).mockReturnValue(status)
    const deps = dependencies(client, [])
    const attempt = startPreProfilePairing({
      offer: directOffer,
      timeoutMs: 5_000,
      dependencies: deps
    })
    await vi.waitFor(() => expect(client.sendRequest).toHaveBeenCalledWith('status.get'))
    attempt.dispose()
    resolveStatus(success({ version: '1.0.0' }))

    await expect(attempt.result).rejects.toThrow(/cancelled/)
    expect(client.close).toHaveBeenCalledOnce()
    expect(deps.savePairedHost).not.toHaveBeenCalled()
  })
})
