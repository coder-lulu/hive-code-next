import { describe, expect, it, vi } from 'vitest'
import { authenticateCloudManagedE2EE } from './cloud-managed-e2ee-auth-validation'

const auth = {
  type: 'e2ee_auth',
  principalKind: 'cloud_managed_web_session',
  managedWebSessionId: '123e4567-e89b-42d3-a456-426614174000',
  runtimeSessionId: '223e4567-e89b-42d3-a456-426614174000',
  sessionToken: 'A'.repeat(43),
  clientCapabilities: ['agent-session-boundary-v1']
}

describe('Cloud-managed E2EE auth validation', () => {
  it('resolves the exact Cloud principal frame', () => {
    const resolveSession = vi.fn().mockReturnValue({ kind: 'cloud' })

    expect(
      authenticateCloudManagedE2EE({ plaintext: JSON.stringify(auth), resolveSession })
    ).toEqual({ kind: 'authenticated', auth, principal: { kind: 'cloud' } })
    expect(resolveSession).toHaveBeenCalledWith(auth)
  })

  it('leaves legacy pairing frames to the existing validator', () => {
    const resolveSession = vi.fn()

    expect(
      authenticateCloudManagedE2EE({
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
        plaintext: JSON.stringify(candidate),
        resolveSession: () => ({ kind: 'cloud' })
      })
    ).toEqual({ kind: 'bad_auth' })
  })

  it('distinguishes a valid frame for a revoked session', () => {
    expect(
      authenticateCloudManagedE2EE({
        plaintext: JSON.stringify(auth),
        resolveSession: () => null
      })
    ).toEqual({ kind: 'unauthorized' })
  })
})
