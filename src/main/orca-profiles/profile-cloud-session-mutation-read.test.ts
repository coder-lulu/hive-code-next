import type * as fs from 'node:fs'
import { beforeEach, expect, it, vi } from 'vitest'
const ports = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }))
vi.mock('node:fs', async (original) => ({
  ...(await original<typeof fs>()),
  readFileSync: ports.read
}))
vi.mock('../../shared/secure-file', () => ({ writeSecureJsonFile: ports.write }))
import {
  captureCloudSessionMutation,
  readCloudSessionMutationSnapshot
} from './profile-cloud-session-mutation'
const identity = {
  localProfileId: 'profile',
  cloudUserId: 'user',
  cloudProfileId: 'cloud',
  organizationId: 'org'
}
beforeEach(() => {
  vi.resetAllMocks()
})
it.each(['EACCES', 'EIO', 'EPERM'])(
  'refuses to initialize over an unreadable %s tombstone',
  (code) => {
    ports.read.mockImplementation(() => {
      throw Object.assign(new Error('unreadable'), { code })
    })
    expect(() => captureCloudSessionMutation(identity, '/state')).toThrow(
      'invalid_cloud_session_mutation_state'
    )
    expect(ports.write).not.toHaveBeenCalled()
  }
)
it('initializes a fence only when its file or parent is absent', () => {
  ports.read.mockImplementation(() => {
    throw Object.assign(new Error('absent'), { code: 'ENOENT' })
  })
  expect(readCloudSessionMutationSnapshot('profile', '/state')).toBeNull()
  expect(captureCloudSessionMutation(identity, '/state').epoch).toBe(0)
  expect(ports.write).toHaveBeenCalledOnce()
})
it('refuses malformed persisted authority without rewriting it', () => {
  ports.read.mockReturnValue('{broken')
  expect(() => captureCloudSessionMutation(identity, '/state')).toThrow(
    'invalid_cloud_session_mutation_state'
  )
  expect(ports.write).not.toHaveBeenCalled()
})
