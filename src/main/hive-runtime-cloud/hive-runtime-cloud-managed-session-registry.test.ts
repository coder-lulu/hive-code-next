import { describe, expect, it, vi } from 'vitest'
import {
  HiveRuntimeCloudManagedSessionRegistry,
  type HiveRuntimeCloudCurrentTuple
} from './hive-runtime-cloud-managed-session-registry'

const MANAGED_SESSION_ID = '123e4567-e89b-42d3-a456-426614174000'
const RUNTIME_SESSION_ID = '223e4567-e89b-42d3-a456-426614174000'
const SESSION_TOKEN = 'A'.repeat(43)
const SECOND_SESSION_TOKEN = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE'
const NOW = 1_900_000_000_000

function currentTuple(
  overrides: Partial<HiveRuntimeCloudCurrentTuple> = {}
): HiveRuntimeCloudCurrentTuple {
  return {
    authorityGeneration: 3,
    runtimeRecordId: '323e4567-e89b-42d3-a456-426614174000',
    runtimeInstanceId: '423e4567-e89b-42d3-a456-426614174000',
    bootId: '523e4567-e89b-42d3-a456-426614174000',
    heartbeatLeaseId: '623e4567-e89b-42d3-a456-426614174000',
    leaseEpoch: 7,
    fencingEpoch: 5,
    ...overrides
  }
}

function register(
  registry: HiveRuntimeCloudManagedSessionRegistry,
  overrides: Partial<Parameters<typeof registry.register>[0]> = {}
) {
  return registry.register({
    managedWebSessionId: MANAGED_SESSION_ID,
    runtimeSessionId: RUNTIME_SESSION_ID,
    currentTuple: currentTuple(),
    expiresAt: NOW + 60_000,
    controlVersion: 1,
    sessionToken: SESSION_TOKEN,
    ...overrides
  })
}

describe('Hive Runtime Cloud managed session registry', () => {
  it('generates a 32-byte token and resolves a secret-free discriminated principal', () => {
    const registry = new HiveRuntimeCloudManagedSessionRegistry()
    const created = registry.register({
      managedWebSessionId: MANAGED_SESSION_ID,
      runtimeSessionId: RUNTIME_SESSION_ID,
      currentTuple: currentTuple(),
      expiresAt: NOW + 60_000,
      controlVersion: 1
    })

    expect(created.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(
      registry.resolve({
        managedWebSessionId: MANAGED_SESSION_ID,
        runtimeSessionId: RUNTIME_SESSION_ID,
        sessionToken: created.sessionToken,
        currentTuple: currentTuple(),
        now: NOW
      })
    ).toEqual(created.principal)
    expect(created.principal).toEqual({
      principalKind: 'cloud_managed_web_session',
      managedWebSessionId: MANAGED_SESSION_ID,
      runtimeSessionId: RUNTIME_SESSION_ID,
      currentTuple: currentTuple(),
      expiresAt: NOW + 60_000
    })
    expect(JSON.stringify(created.principal)).not.toContain(created.sessionToken)
  })

  it('accepts a supplied token but rejects wrong tokens and session identifiers', () => {
    const registry = new HiveRuntimeCloudManagedSessionRegistry()
    register(registry)

    const base = {
      managedWebSessionId: MANAGED_SESSION_ID,
      runtimeSessionId: RUNTIME_SESSION_ID,
      currentTuple: currentTuple(),
      now: NOW
    }
    expect(registry.resolve({ ...base, sessionToken: SESSION_TOKEN })).not.toBeNull()
    expect(registry.resolve({ ...base, sessionToken: SECOND_SESSION_TOKEN })).toBeNull()
    expect(
      registry.resolve({
        ...base,
        runtimeSessionId: '723e4567-e89b-42d3-a456-426614174000',
        sessionToken: SESSION_TOKEN
      })
    ).toBeNull()
  })

  it('revalidates the bound principal without repeating its token', () => {
    const registry = new HiveRuntimeCloudManagedSessionRegistry()
    const bootstrap = register(registry)

    expect(registry.revalidate(bootstrap.principal, currentTuple(), NOW)).toBe(true)
    expect(registry.revalidate(bootstrap.principal, currentTuple({ fencingEpoch: 6 }), NOW)).toBe(
      false
    )
    expect(registry.size).toBe(0)
  })

  it('rejects malformed supplied tokens before registration', () => {
    const registry = new HiveRuntimeCloudManagedSessionRegistry()

    expect(() => register(registry, { sessionToken: 'too-short' })).toThrow(
      'invalid_cloud_managed_session_token'
    )
    expect(() => register(registry, { sessionToken: 'B'.repeat(43) })).toThrow(
      'invalid_cloud_managed_session_token'
    )
    expect(registry.size).toBe(0)
  })

  it('expires a session and emits only its secret-free principal', () => {
    const onInvalidate = vi.fn()
    const registry = new HiveRuntimeCloudManagedSessionRegistry({ onInvalidate })
    const created = register(registry, { expiresAt: NOW })

    expect(
      registry.resolve({
        managedWebSessionId: MANAGED_SESSION_ID,
        runtimeSessionId: RUNTIME_SESSION_ID,
        sessionToken: SESSION_TOKEN,
        currentTuple: currentTuple(),
        now: NOW
      })
    ).toBeNull()
    expect(registry.size).toBe(0)
    expect(onInvalidate).toHaveBeenCalledWith({ reason: 'EXPIRED', principal: created.principal })
    expect(JSON.stringify(onInvalidate.mock.calls)).not.toContain(SESSION_TOKEN)
  })

  it('fails closed and invalidates a session when the authoritative tuple changes', () => {
    const onInvalidate = vi.fn()
    const registry = new HiveRuntimeCloudManagedSessionRegistry({ onInvalidate })
    const created = register(registry)

    expect(
      registry.resolve({
        managedWebSessionId: MANAGED_SESSION_ID,
        runtimeSessionId: RUNTIME_SESSION_ID,
        sessionToken: SESSION_TOKEN,
        currentTuple: currentTuple({ leaseEpoch: 8 }),
        now: NOW
      })
    ).toBeNull()
    expect(onInvalidate).toHaveBeenCalledWith({
      reason: 'TUPLE_FENCED',
      principal: created.principal
    })
  })

  it('revokes or removes only an exact session identifier pair', () => {
    const onInvalidate = vi.fn()
    const registry = new HiveRuntimeCloudManagedSessionRegistry({ onInvalidate })
    const created = register(registry)

    expect(
      registry.revoke({
        managedWebSessionId: MANAGED_SESSION_ID,
        runtimeSessionId: '723e4567-e89b-42d3-a456-426614174000'
      })
    ).toBe(false)
    expect(
      registry.revoke({
        managedWebSessionId: MANAGED_SESSION_ID,
        runtimeSessionId: RUNTIME_SESSION_ID
      })
    ).toBe(true)
    expect(onInvalidate).toHaveBeenCalledWith({
      reason: 'REVOKED',
      principal: created.principal
    })

    register(registry)
    expect(
      registry.remove({
        managedWebSessionId: MANAGED_SESSION_ID,
        runtimeSessionId: RUNTIME_SESSION_ID
      })
    ).toBe(true)
    expect(onInvalidate).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'REMOVED' }))
  })

  it('accepts only a newer control version for the exact runtime session', () => {
    const onInvalidate = vi.fn()
    const registry = new HiveRuntimeCloudManagedSessionRegistry({ onInvalidate })
    register(registry, { controlVersion: 1 })

    expect(
      registry.revokeControlled({
        managedWebSessionId: MANAGED_SESSION_ID,
        runtimeSessionId: '723e4567-e89b-42d3-a456-426614174000',
        controlVersion: 2
      })
    ).toBe('MISMATCH')
    expect(
      registry.revokeControlled({
        managedWebSessionId: MANAGED_SESSION_ID,
        runtimeSessionId: RUNTIME_SESSION_ID,
        controlVersion: 1
      })
    ).toBe('STALE')
    expect(registry.size).toBe(1)
    expect(onInvalidate).not.toHaveBeenCalled()

    expect(
      registry.revokeControlled({
        managedWebSessionId: MANAGED_SESSION_ID,
        runtimeSessionId: RUNTIME_SESSION_ID,
        controlVersion: 2
      })
    ).toBe('REVOKED')
    expect(
      registry.revokeControlled({
        managedWebSessionId: MANAGED_SESSION_ID,
        runtimeSessionId: RUNTIME_SESSION_ID,
        controlVersion: 2
      })
    ).toBe('ABSENT')
    expect(onInvalidate).toHaveBeenCalledOnce()
  })

  it('prunes expired sessions without waiting for another authentication attempt', () => {
    const onInvalidate = vi.fn()
    const registry = new HiveRuntimeCloudManagedSessionRegistry({ onInvalidate })
    register(registry, { expiresAt: NOW })

    expect(registry.pruneExpired(NOW)).toBe(1)
    expect(registry.size).toBe(0)
    expect(onInvalidate).toHaveBeenCalledWith(expect.objectContaining({ reason: 'EXPIRED' }))
  })

  it('fences only sessions outside the current full tuple and can clear the remainder', () => {
    const onInvalidate = vi.fn()
    const registry = new HiveRuntimeCloudManagedSessionRegistry({ onInvalidate })
    register(registry)
    register(registry, {
      managedWebSessionId: '823e4567-e89b-42d3-a456-426614174000',
      runtimeSessionId: '923e4567-e89b-42d3-a456-426614174000',
      currentTuple: currentTuple({ bootId: 'a23e4567-e89b-42d3-a456-426614174000' }),
      sessionToken: SECOND_SESSION_TOKEN
    })

    expect(registry.fenceTuple(currentTuple())).toBe(1)
    expect(registry.size).toBe(1)
    expect(onInvalidate).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'TUPLE_FENCED',
        principal: expect.objectContaining({
          managedWebSessionId: '823e4567-e89b-42d3-a456-426614174000'
        })
      })
    )
    expect(registry.clear()).toBe(1)
    expect(registry.size).toBe(0)
    expect(onInvalidate).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'CLEARED' }))
  })

  it('invalidates an old token when an identifier pair is replaced', () => {
    const onInvalidate = vi.fn()
    const registry = new HiveRuntimeCloudManagedSessionRegistry({ onInvalidate })
    const old = register(registry)
    register(registry, { sessionToken: SECOND_SESSION_TOKEN })

    expect(
      registry.resolve({
        managedWebSessionId: MANAGED_SESSION_ID,
        runtimeSessionId: RUNTIME_SESSION_ID,
        sessionToken: SESSION_TOKEN,
        currentTuple: currentTuple(),
        now: NOW
      })
    ).toBeNull()
    expect(onInvalidate).toHaveBeenCalledWith({ reason: 'REPLACED', principal: old.principal })
  })

  it('does not restore sessions when a new registry represents a process restart', () => {
    const firstProcess = new HiveRuntimeCloudManagedSessionRegistry()
    register(firstProcess)

    expect(new HiveRuntimeCloudManagedSessionRegistry().size).toBe(0)
  })
})
