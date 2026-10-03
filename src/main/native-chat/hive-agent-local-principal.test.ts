import { expect, it, vi } from 'vitest'
import { HiveAgentLocalPrincipal } from './hive-agent-local-principal'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-publication'
import { EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP } from '../../shared/hive-runtime-cloud'

const accountId = '11111111-1111-4111-8111-111111111111'
const deviceId = '22222222-2222-4222-8222-222222222222'
function fixture() {
  let clock = Date.now()
  let authorization: HiveRuntimeCloudAuthorization | null = {
    accountId,
    authorityId: 'authority',
    accessToken: 'private-credential',
    sessionGeneration: 1,
    sessionExpiresAt: clock + 120_000
  }
  let owner = {
    ...EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP,
    relation: 'CLAIMED_BY_CURRENT' as const,
    presence: 'ONLINE' as const,
    accountId,
    sessionGeneration: 1,
    runtimeRecordId: 'local-runtime'
  }
  let projectAvailable = true
  let origin = 'https://cloud.example.test'
  const accountListeners = new Set<() => void>()
  const ownershipListeners = new Set<() => void>()
  const client = {
    getCurrentIdentity: vi.fn(async () => ({
      contract: 'hive-runtime-local-identity-v1' as const,
      accountId,
      deviceId,
      authorityId: 'authority',
      expiresAt: clock + 90_000
    }))
  }
  const project = vi.fn(async () => ({
    projectScope: 'folder:verified-project',
    workspaceKind: 'folder' as const,
    assertCurrent() {
      if (!projectAvailable) {
        throw new Error('project removed')
      }
    }
  }))
  const producer = new HiveAgentLocalPrincipal(
    {
      getRuntimeCloudAuthorization: () => authorization,
      subscribeRuntimeCloudAuthorization: (listener) => {
        const notify = () => listener(authorization)
        accountListeners.add(notify)
        return () => {
          accountListeners.delete(notify)
        }
      }
    },
    {
      getState: () => owner,
      subscribe: (listener) => {
        const notify = () => listener(owner)
        ownershipListeners.add(notify)
        notify()
        return () => {
          ownershipListeners.delete(notify)
        }
      }
    },
    () => ({
      configured: true,
      config: { apiBaseUrl: origin, identityIssuer: '', userLoginUrl: '', clientId: '', scope: '' }
    }),
    project,
    () => client,
    () => clock
  )
  return {
    producer,
    client,
    project,
    accountListeners,
    ownershipListeners,
    advance: (ms: number) => {
      clock += ms
    },
    removeProject: () => {
      projectAvailable = false
    },
    restoreProject: () => {
      projectAvailable = true
    },
    changeOrigin: () => {
      origin = 'https://other.example.test'
    },
    signOut: () => {
      authorization = null
      accountListeners.forEach((notify) => notify())
    },
    transfer: () => {
      owner = { ...owner, runtimeRecordId: 'different-runtime' }
      ownershipListeners.forEach((notify) => notify())
    },
    rotate: () => {
      authorization = { ...authorization!, accessToken: 'new-credential', sessionGeneration: 2 }
      owner = { ...owner, sessionGeneration: 2 }
      accountListeners.forEach((notify) => notify())
      ownershipListeners.forEach((notify) => notify())
    }
  }
}
it('binds only verified device identity and resolved project without exposing credentials or tools', async () => {
  const f = fixture()
  try {
    const binding = await f.producer.bindProject('id:folder:verified-project')
    const principal = binding.resolvePrincipal()!
    expect(principal).toMatchObject({
      kind: 'local',
      accountId,
      deviceId,
      runtimeRecordId: 'local-runtime',
      projectScope: 'folder:verified-project'
    })
    expect(principal.toolScopes).toEqual([])
    expect(principal.expiry).toBeLessThanOrEqual(Date.now() + 60_000)
    expect(f.project).toHaveBeenCalledWith('id:folder:verified-project')
    expect(Object.isFrozen(principal)).toBe(true)
    expect(Object.isFrozen(principal.allowedMethods)).toBe(true)
    expect(JSON.stringify(principal)).not.toContain('private-credential')
    expect(() =>
      binding.assertAuthorized({
        accountId,
        deviceId,
        runtimeRecordId: 'local-runtime',
        projectScope: principal.projectScope,
        workspaceKind: 'folder',
        sessionId: 'ha-session:33333333-3333-4333-8333-333333333333'
      })
    ).not.toThrow()
    expect(() =>
      binding.assertAuthorized({
        accountId,
        deviceId,
        runtimeRecordId: 'rival-runtime',
        projectScope: principal.projectScope,
        workspaceKind: 'folder',
        sessionId: 'ha-session:33333333-3333-4333-8333-333333333333'
      })
    ).toThrow('hive_agent_forbidden')
    expect(binding.resolvePrincipal()).toBe(principal)
  } finally {
    f.producer.stop()
  }
})
it.each(['signOut', 'transfer', 'rotate', 'removeProject', 'changeOrigin'] as const)(
  'invalidates a previously bound resolver after %s',
  async (action) => {
    const f = fixture()
    try {
      const binding = await f.producer.bindProject('verified-project')
      f[action]()
      expect(binding.resolvePrincipal()).toBeNull()
    } finally {
      f.producer.stop()
    }
  }
)
it('expires the local proof even when the refresh session remains valid', async () => {
  const f = fixture()
  try {
    const binding = await f.producer.bindProject('verified-project')
    f.advance(60_001)
    expect(binding.resolvePrincipal()).toBeNull()
  } finally {
    f.producer.stop()
  }
})
it('rejects another account or authority returned by the identity endpoint', async () => {
  const f = fixture()
  try {
    f.client.getCurrentIdentity.mockResolvedValueOnce({
      contract: 'hive-runtime-local-identity-v1',
      accountId: deviceId,
      deviceId,
      authorityId: 'authority',
      expiresAt: Date.now() + 60_000
    })
    await expect(f.producer.bindProject('verified-project')).rejects.toThrow()
    f.client.getCurrentIdentity.mockResolvedValueOnce({
      contract: 'hive-runtime-local-identity-v1',
      accountId,
      deviceId,
      authorityId: 'rival-authority',
      expiresAt: Date.now() + 60_000
    })
    await expect(f.producer.bindProject('verified-project')).rejects.toThrow()
  } finally {
    f.producer.stop()
  }
})
it('rejects late identity completion after an ownership transfer', async () => {
  const f = fixture()
  try {
    let complete!: (value: Awaited<ReturnType<typeof f.client.getCurrentIdentity>>) => void
    f.client.getCurrentIdentity.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve
        })
    )
    const binding = f.producer.bindProject('verified-project')
    await vi.waitFor(() => expect(f.client.getCurrentIdentity).toHaveBeenCalled())
    f.transfer()
    complete({
      contract: 'hive-runtime-local-identity-v1',
      accountId,
      deviceId,
      authorityId: 'authority',
      expiresAt: Date.now() + 60_000
    })
    await expect(binding).rejects.toThrow('hive_agent_forbidden')
  } finally {
    f.producer.stop()
  }
})
it('does not query identity or resolve a project after logout and closes all listeners on shutdown', async () => {
  const f = fixture()
  f.signOut()
  await expect(f.producer.bindProject('verified-project')).rejects.toThrow('hive_agent_forbidden')
  expect(f.client.getCurrentIdentity).not.toHaveBeenCalled()
  expect(f.project).not.toHaveBeenCalled()
  f.producer.stop()
  f.producer.stop()
  expect(f.accountListeners.size).toBe(0)
  expect(f.ownershipListeners.size).toBe(0)
})
it('cancels pending noncooperative identity I/O and removes temporary listeners on shutdown', async () => {
  const f = fixture()
  f.client.getCurrentIdentity.mockImplementationOnce(() => new Promise(() => {}))
  const binding = f.producer.bindProject('verified-project')
  await vi.waitFor(() => expect(f.client.getCurrentIdentity).toHaveBeenCalled())
  f.producer.stop()
  await expect(binding).rejects.toThrow()
  expect(f.accountListeners.size).toBe(0)
  expect(f.ownershipListeners.size).toBe(0)
})
it.each(['project-restoration', 'clock-rollback'] as const)(
  'requires a fresh binding after observed revocation despite %s',
  async (mode) => {
    const f = fixture()
    try {
      const binding = await f.producer.bindProject('verified-project')
      if (mode === 'clock-rollback') {
        f.advance(60_001)
      } else {
        f.removeProject()
      }
      expect(binding.resolvePrincipal()).toBeNull()
      if (mode === 'clock-rollback') {
        f.advance(-60_001)
      } else {
        f.restoreProject()
      }
      expect(binding.resolvePrincipal()).toBeNull()
      const fresh = await f.producer.bindProject('verified-project')
      expect(fresh.resolvePrincipal()).not.toBeNull()
      expect(f.client.getCurrentIdentity).toHaveBeenCalledTimes(2)
    } finally {
      f.producer.stop()
    }
  }
)
