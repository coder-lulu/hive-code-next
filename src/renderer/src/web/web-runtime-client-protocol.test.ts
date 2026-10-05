import { describe, expect, it } from 'vitest'
import type { RuntimeRpcSuccess } from '../../../shared/runtime-rpc-envelope'
import {
  createFileWatchReplayOverflowResponse,
  getFileWatchSubscriptionId,
  isEndResult,
  isFileWatchStartingResponse,
  isRuntimeFailureResponse,
  normalizeConnection,
  websocketPayloadToUint8
} from './web-runtime-client-protocol'

describe('web runtime client protocol boundary', () => {
  it('normalizes pairing and Cloud launch inputs without changing credentials', () => {
    expect(
      normalizeConnection({
        v: 2,
        endpoint: 'ws://127.0.0.1:6768',
        deviceToken: 'pairing-token',
        publicKeyB64: 'pairing-key'
      })
    ).toEqual({
      kind: 'pairing',
      endpoint: 'ws://127.0.0.1:6768',
      deviceToken: 'pairing-token',
      publicKeyB64: 'pairing-key'
    })

    expect(
      normalizeConnection({
        protocolVersion: 'cloud-launch/v1',
        managedWebSessionId: 'managed-session',
        runtimeSessionId: 'runtime-session',
        websocketUrl: 'wss://runtime.example/rpc',
        serverPublicKeyB64: 'cloud-key',
        sessionToken: 'session-token',
        expiresAt: '2026-08-25T09:00:00.000Z',
        runtimeDisplayMetadata: {
          runtimeRecordId: '423e4567-e89b-42d3-a456-426614174000',
          resourceVersion: 7,
          ownershipEpoch: 8,
          cloudDisplayName: null,
          cloudDisplayNameVersion: 1,
          deviceName: null
        }
      })
    ).toEqual({
      kind: 'cloud-managed',
      endpoint: 'wss://runtime.example/rpc',
      publicKeyB64: 'cloud-key',
      managedWebSessionId: 'managed-session',
      runtimeSessionId: 'runtime-session',
      sessionToken: 'session-token',
      expiresAt: '2026-08-25T09:00:00.000Z'
    })
  })

  it('keeps file-watch response classification and overflow replay stable', () => {
    const starting = {
      id: 'watch-ready',
      ok: true as const,
      result: { type: 'starting' as const, subscriptionId: 'remote-watch' },
      _meta: { runtimeId: 'runtime' }
    }
    expect(isFileWatchStartingResponse(starting)).toBe(true)
    expect(
      isFileWatchStartingResponse({
        id: 'watch-without-id',
        ok: true,
        result: { type: 'starting' },
        _meta: { runtimeId: 'runtime' }
      })
    ).toBe(false)
    expect(getFileWatchSubscriptionId(starting)).toBe('remote-watch')
    expect(
      createFileWatchReplayOverflowResponse(starting as RuntimeRpcSuccess<unknown>, {
        worktree: 'C:/repo'
      })
    ).toEqual({
      id: 'watch-ready',
      ok: true,
      _meta: { runtimeId: 'runtime' },
      result: {
        type: 'changed',
        worktree: 'C:/repo',
        events: [{ kind: 'overflow', absolutePath: '' }]
      }
    })
    expect(
      getFileWatchSubscriptionId({ id: 'failed', ok: false, error: { code: 'x', message: 'y' } })
    ).toBe(null)
  })

  it('preserves RPC failure/end classification and binary payload conversion', async () => {
    expect(
      isRuntimeFailureResponse({ ok: false, error: { code: 'unauthorized', message: 'expired' } })
    ).toBe(true)
    expect(isRuntimeFailureResponse(null)).toBe(false)
    expect(isRuntimeFailureResponse('malformed-frame')).toBe(false)
    expect(isRuntimeFailureResponse([])).toBe(false)
    expect(isRuntimeFailureResponse({ ok: true, result: null })).toBe(false)
    expect(isEndResult({ type: 'end' })).toBe(true)
    expect(isEndResult({ type: 'data' })).toBe(false)

    const bytes = new Uint8Array([1, 2, 3])
    expect(await websocketPayloadToUint8(bytes)).toBe(bytes)
    expect(await websocketPayloadToUint8(bytes.buffer)).toEqual(bytes)
    expect(await websocketPayloadToUint8('not-binary')).toBeNull()
  })
})
