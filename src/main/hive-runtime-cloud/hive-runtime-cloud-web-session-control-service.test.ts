import { generateKeyPairSync } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HiveRuntimeCloudIdentity } from './hive-runtime-cloud-identity-store'
import type { CurrentHiveRuntimeCloudLeaseContext } from './hive-runtime-cloud-lease-context'
import { HiveRuntimeCloudWebSessionControlService } from './hive-runtime-cloud-web-session-control-service'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))

const MANAGED_SESSION_ID = '123e4567-e89b-42d3-a456-426614174000'
const RUNTIME_SESSION_ID = '223e4567-e89b-42d3-a456-426614174000'
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const identity: HiveRuntimeCloudIdentity = {
  schemaVersion: 1,
  runtimeInstanceId: '323e4567-e89b-42d3-a456-426614174000',
  privateKeyPkcs8: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  publicKey: (publicKey.export({ format: 'jwk' }) as { x: string }).x,
  createdAt: 1
}

function leaseContext(
  overrides: Partial<CurrentHiveRuntimeCloudLeaseContext['tuple']> = {}
): CurrentHiveRuntimeCloudLeaseContext {
  return {
    authorityId: 'hive-primary',
    identity,
    tuple: {
      authorityGeneration: 2,
      runtimeRecordId: '423e4567-e89b-42d3-a456-426614174000',
      runtimeInstanceId: identity.runtimeInstanceId,
      bootId: '523e4567-e89b-42d3-a456-426614174000',
      heartbeatLeaseId: '623e4567-e89b-42d3-a456-426614174000',
      leaseEpoch: 3,
      fencingEpoch: 4,
      ...overrides
    }
  }
}

const command = {
  managedWebSessionId: MANAGED_SESSION_ID,
  runtimeSessionId: RUNTIME_SESSION_ID,
  controlVersion: 2,
  action: 'REVOKE' as const
}

class TestPresence {
  private readonly listeners = new Set<
    (value: CurrentHiveRuntimeCloudLeaseContext | null) => void
  >()

  constructor(private value: CurrentHiveRuntimeCloudLeaseContext | null) {}

  getCurrentLeaseContext(): CurrentHiveRuntimeCloudLeaseContext | null {
    return this.value
  }

  subscribeLeaseContext(
    listener: (value: CurrentHiveRuntimeCloudLeaseContext | null) => void
  ): () => void {
    this.listeners.add(listener)
    listener(this.value)
    return () => this.listeners.delete(listener)
  }

  set(value: CurrentHiveRuntimeCloudLeaseContext | null): void {
    this.value = value
    for (const listener of this.listeners) {
      listener(value)
    }
  }
}

function testHarness() {
  const presence = new TestPresence(leaseContext())
  const pullWebSessionControls = vi.fn().mockResolvedValue({ commands: [] })
  const acknowledgeWebSessionRevocations = vi.fn().mockResolvedValue(undefined)
  const revokeManagedSession = vi.fn().mockReturnValue('REVOKED')
  const expireManagedSessions = vi.fn().mockReturnValue(0)
  const service = new HiveRuntimeCloudWebSessionControlService({
    apiBaseUrl: 'https://api.hivekernel.com',
    presence,
    target: { revokeManagedSession, expireManagedSessions },
    client: { pullWebSessionControls, acknowledgeWebSessionRevocations }
  })
  return {
    presence,
    pullWebSessionControls,
    acknowledgeWebSessionRevocations,
    revokeManagedSession,
    expireManagedSessions,
    service
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('Hive Runtime Cloud Web Session control service', () => {
  it('pulls with the current tuple and acks only after local revocation', async () => {
    const harness = testHarness()
    const events: string[] = []
    harness.pullWebSessionControls.mockImplementation(async () => {
      events.push('pull')
      return { commands: [command] }
    })
    harness.revokeManagedSession.mockImplementation(() => {
      events.push('revoke-and-terminate')
      return 'REVOKED'
    })
    harness.acknowledgeWebSessionRevocations.mockImplementation(async () => {
      events.push('ack')
    })

    await harness.service.pollNow()

    expect(events).toEqual(['pull', 'revoke-and-terminate', 'ack'])
    expect(harness.pullWebSessionControls).toHaveBeenCalledWith(
      expect.objectContaining({
        protocolVersion: 'web-session-control-pull/v1',
        ...leaseContext().tuple,
        limit: 50
      }),
      expect.any(AbortSignal)
    )
    expect(harness.acknowledgeWebSessionRevocations).toHaveBeenCalledWith(
      expect.objectContaining({
        protocolVersion: 'web-session-revocation-ack/v1',
        ...leaseContext().tuple,
        acknowledgements: [
          { managedWebSessionId: MANAGED_SESSION_ID, controlVersion: 2, action: 'REVOKE' }
        ]
      }),
      expect.any(AbortSignal)
    )
  })

  it('retains a locally applied ack across an ack and subsequent pull network failure', async () => {
    const harness = testHarness()
    harness.pullWebSessionControls
      .mockResolvedValueOnce({ commands: [command] })
      .mockRejectedValueOnce(new Error('offline'))
    harness.acknowledgeWebSessionRevocations
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined)

    await harness.service.pollNow()
    await harness.service.pollNow()

    expect(harness.pullWebSessionControls).toHaveBeenCalledTimes(2)
    expect(harness.revokeManagedSession).toHaveBeenCalledOnce()
    expect(harness.acknowledgeWebSessionRevocations).toHaveBeenCalledTimes(2)
  })

  it('does not apply or ack a reordered lower control version', async () => {
    const harness = testHarness()
    harness.revokeManagedSession.mockReturnValue('ABSENT')
    harness.pullWebSessionControls
      .mockResolvedValueOnce({ commands: [{ ...command, controlVersion: 3 }] })
      .mockResolvedValueOnce({ commands: [{ ...command, controlVersion: 2 }] })

    await harness.service.pollNow()
    await harness.service.pollNow()

    expect(harness.revokeManagedSession).toHaveBeenCalledOnce()
    expect(harness.acknowledgeWebSessionRevocations).toHaveBeenCalledOnce()
  })

  it.each(['MISMATCH', 'STALE'] as const)('does not ack a %s local result', async (result) => {
    const harness = testHarness()
    harness.pullWebSessionControls.mockResolvedValue({ commands: [command] })
    harness.revokeManagedSession.mockReturnValue(result)

    await harness.service.pollNow()

    expect(harness.acknowledgeWebSessionRevocations).not.toHaveBeenCalled()
  })

  it('never applies a command after sign-out wins the pull race', async () => {
    const harness = testHarness()
    let completePull!: (value: { commands: [typeof command] }) => void
    harness.pullWebSessionControls.mockReturnValue(
      new Promise((resolve) => {
        completePull = resolve
      })
    )
    const polling = harness.service.pollNow()

    harness.presence.set(null)
    completePull({ commands: [command] })
    await polling

    expect(harness.revokeManagedSession).not.toHaveBeenCalled()
    expect(harness.acknowledgeWebSessionRevocations).not.toHaveBeenCalled()
  })

  it('drops pending acknowledgements instead of signing them with a new tuple', async () => {
    const harness = testHarness()
    harness.pullWebSessionControls
      .mockResolvedValueOnce({ commands: [command] })
      .mockResolvedValueOnce({ commands: [] })
    harness.acknowledgeWebSessionRevocations.mockRejectedValueOnce(new Error('offline'))

    await harness.service.pollNow()
    harness.presence.set(leaseContext({ fencingEpoch: 5 }))
    await harness.service.pollNow()

    expect(harness.acknowledgeWebSessionRevocations).toHaveBeenCalledOnce()
  })

  it('acks an already absent restart session and prunes expiry before every pull', async () => {
    const harness = testHarness()
    harness.pullWebSessionControls.mockResolvedValue({ commands: [command] })
    harness.revokeManagedSession.mockReturnValue('ABSENT')

    await harness.service.pollNow()

    expect(harness.expireManagedSessions.mock.invocationCallOrder[0]).toBeLessThan(
      harness.pullWebSessionControls.mock.invocationCallOrder[0]!
    )
    expect(harness.acknowledgeWebSessionRevocations).toHaveBeenCalledOnce()
  })

  it('starts pulls no more than 15 seconds apart and rejects a slower configuration', async () => {
    vi.useFakeTimers()
    const harness = testHarness()
    harness.service.start()

    await vi.advanceTimersByTimeAsync(0)
    expect(harness.pullWebSessionControls).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(14_999)
    expect(harness.pullWebSessionControls).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(harness.pullWebSessionControls).toHaveBeenCalledTimes(2)
    await harness.service.stop()

    expect(
      () =>
        new HiveRuntimeCloudWebSessionControlService({
          apiBaseUrl: 'https://api.hivekernel.com',
          presence: harness.presence,
          target: {
            revokeManagedSession: harness.revokeManagedSession,
            expireManagedSessions: harness.expireManagedSessions
          },
          client: {
            pullWebSessionControls: harness.pullWebSessionControls,
            acknowledgeWebSessionRevocations: harness.acknowledgeWebSessionRevocations
          },
          pullIntervalMs: 15_001
        })
    ).toThrow('invalid_web_session_control_pull_interval')
  })
})
