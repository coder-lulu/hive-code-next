import { describe, expect, it, vi } from 'vitest'
import { authenticateE2EEChannel } from './e2ee-channel-authentication'
import { authenticateCloudManagedE2EE } from './cloud-managed-e2ee-auth-validation'

const auth = {
  type: 'e2ee_auth',
  v: 2,
  transcriptHashB64: 'transcript',
  principalKind: 'cloud_managed_web_session',
  managedWebSessionId: '123e4567-e89b-42d3-a456-426614174000',
  runtimeSessionId: '223e4567-e89b-42d3-a456-426614174000',
  sessionToken: 'A'.repeat(43),
  clientCapabilities: ['agent-session-boundary-v1']
}

describe('Cloud-managed E2EE auth validation', () => {
  it.each([false, true])('rejects null authentication with Cloud resolver enabled=%s', (cloud) => {
    const resolveDevice = vi.fn()
    const resolveCloudSession = vi.fn()
    expect(
      authenticateE2EEChannel({
        plaintext: 'null',
        v2Session: null,
        resolveDevice,
        ...(cloud ? { resolveCloudSession } : {})
      })
    ).toEqual({ ok: false, principalKind: 'paired_device', code: 'bad_auth' })
    expect(resolveDevice).not.toHaveBeenCalled()
    expect(resolveCloudSession).not.toHaveBeenCalled()
  })

  it('resolves the exact Cloud principal frame', () => {
    const resolveSession = vi.fn().mockReturnValue({ kind: 'cloud' })

    expect(
      authenticateCloudManagedE2EE({
        transcriptHashB64: 'transcript',
        plaintext: JSON.stringify(auth),
        resolveSession
      })
    ).toEqual({ kind: 'authenticated', auth, principal: { kind: 'cloud' } })
    expect(resolveSession).toHaveBeenCalledWith(auth)
  })

  it('leaves paired-device frames to the device validator', () => {
    const resolveSession = vi.fn()

    expect(
      authenticateCloudManagedE2EE({
        transcriptHashB64: 'transcript',
        plaintext: JSON.stringify({ type: 'e2ee_auth', deviceToken: 'paired-token' }),
        resolveSession
      })
    ).toEqual({ kind: 'not_cloud' })
    expect(resolveSession).not.toHaveBeenCalled()
  })

  it.each([
    { ...auth, deviceToken: 'forbidden' },
    { ...auth, sessionToken: 'A'.repeat(42) },
    { ...auth, sessionToken: 'B'.repeat(43) },
    { ...auth, managedWebSessionId: auth.managedWebSessionId.toUpperCase() },
    { ...auth, v: 2, transcriptHashB64: 'forbidden' }
  ])('rejects malformed or mixed-provenance frames', (candidate) => {
    expect(
      authenticateCloudManagedE2EE({
        transcriptHashB64: 'transcript',
        plaintext: JSON.stringify(candidate),
        resolveSession: () => ({ kind: 'cloud' })
      })
    ).toEqual({ kind: 'bad_auth' })
  })

  it('distinguishes a valid frame for a revoked session', () => {
    expect(
      authenticateCloudManagedE2EE({
        transcriptHashB64: 'transcript',
        plaintext: JSON.stringify(auth),
        resolveSession: () => null
      })
    ).toEqual({ kind: 'unauthorized' })
  })
})
