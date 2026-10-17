import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const state = vi.hoisted(() => ({
  cloud: {
    userId: 'user',
    cloudProfileId: 'cloud',
    email: 'user@example.com',
    activeOrgId: 'org-a',
    linkedAt: 1
  },
  stored: null as null | {
    accessToken: string
    refreshToken: string
    expiresAt: number
    capabilities: { flags: Record<string, boolean>; refreshedAt: number }
  },
  refuseRemove: false
}))
vi.mock('./profile-index-store', () => ({
  loadOrCreateProfileIndex: () => ({ profiles: [{ id: 'profile', cloud: state.cloud }] }),
  getOrcaProfileListState: () => ({ activeProfileId: 'profile', profiles: [] })
}))
vi.mock('./profile-cloud-index', () => ({
  linkOrcaProfileToCloud: (_id: string, cloud: typeof state.cloud) => {
    state.cloud = cloud
    return { activeProfileId: 'profile', profiles: [] }
  }
}))
vi.mock('./profile-cloud-session-store', () => ({
  orcaCloudSessionKey: (id: string, root: string) => `${root}/${id}`,
  readOrcaCloudSession: () =>
    state.stored
      ? { status: 'found', session: state.stored, persistence: 'encrypted' }
      : { status: 'missing', persistence: 'none' },
  saveOrcaCloudSession: (_id: string, _root: string, session: NonNullable<typeof state.stored>) => {
    state.stored = session
  },
  clearOrcaCloudSession: () => {
    if (state.refuseRemove) {
      throw new Error('locked')
    }
    state.stored = null
  },
  flushUnsavedOrcaCloudSessions: vi.fn()
}))
let root: string
const exchange = () => ({
  cloud: state.cloud,
  accessToken: 'access-a',
  refreshToken: 'refresh-a',
  expiresAt: 100,
  capabilities: { flags: {}, refreshedAt: 1 }
})
beforeEach(() => {
  vi.resetModules()
  root = mkdtempSync(join(tmpdir(), 'hive-cloud-durable-owner-'))
  state.cloud = {
    userId: 'user',
    cloudProfileId: 'cloud',
    email: 'user@example.com',
    activeOrgId: 'org-a',
    linkedAt: 1
  }
  state.stored = null
  state.refuseRemove = false
})
afterEach(() => rmSync(root, { recursive: true, force: true }))
it('keeps signout effective after owner restart when credential deletion fails', async () => {
  const owner = await import('./profile-cloud-session-owner')
  owner.signInCloudSession('profile', root, exchange())
  const ticket = owner.takeCloudSessionTicket('profile', root)
  const spent = state.stored!
  state.refuseRemove = true
  owner.signOutCloudSession('profile', root)
  expect(state.stored).not.toBeNull()
  vi.resetModules()
  const restarted = await import('./profile-cloud-session-owner')
  expect(restarted.readCloudSession('profile', root).status).toBe('missing')
  expect(
    restarted.commitCloudSessionRotation('profile', root, ticket, spent, {
      ...exchange(),
      refreshToken: 'rotated'
    })
  ).toBeNull()
})
it('keeps rotated tokens when an org selection overtakes the refresh', async () => {
  const owner = await import('./profile-cloud-session-owner')
  owner.signInCloudSession('profile', root, exchange())
  const ticket = owner.takeCloudSessionTicket('profile', root)
  const spent = state.stored!
  const relink = owner.beginCloudSessionRelink('profile', root)
  owner.commitCloudSessionRelink('profile', root, relink, {
    cloud: { ...state.cloud, activeOrgId: 'org-b' },
    capabilities: { flags: {}, refreshedAt: 2 }
  })
  expect(
    owner.commitCloudSessionRotation('profile', root, ticket, spent, {
      ...exchange(),
      refreshToken: 'rotated'
    })?.refreshToken
  ).toBe('rotated')
  expect(state.cloud.activeOrgId).toBe('org-b')
})
