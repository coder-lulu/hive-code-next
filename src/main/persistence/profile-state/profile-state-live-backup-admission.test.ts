import { beforeEach, expect, it, vi } from 'vitest'
const ports = vi.hoisted(() => ({ stat: vi.fn(), backup: vi.fn(), prepare: vi.fn() }))
vi.mock('node:fs/promises', () => ({ lstat: ports.stat }))
vi.mock('./profile-state-pre-migration-backup', () => ({
  ensureProfileStatePreMigrationBackup: ports.backup
}))
vi.mock('./profile-state-store-factory', () => ({ prepareProfileStateStore: ports.prepare }))
vi.mock('./profile-state-worker-authority', () => ({ ProfileStateWorkerAuthority: vi.fn() }))
vi.mock('../loading-store/store', () => ({ Store: vi.fn() }))
import { createLiveProfileStateStore } from './profile-state-live-store-factory'
import { ProfileStateDatabaseOpenError } from './profile-state-database-errors'
import { ProfileStateRecoveryRequiredError } from './profile-state-recovery-required'

const options = {
  dataFile: '/profile/data.json',
  databaseFile: '/profile/state.db',
  profileId: 'profile'
}
beforeEach(() => {
  vi.clearAllMocks()
  ports.stat.mockResolvedValue({ isFile: () => true })
  ports.prepare.mockImplementation(() => {
    throw new Error('bootstrap reached')
  })
})
it('blocks bootstrap and saved-state writes when the backup fails', async () => {
  ports.backup.mockResolvedValue('failed')
  await expect(createLiveProfileStateStore(options)).rejects.toThrow('pre-migration backup failed')
  expect(ports.prepare).not.toHaveBeenCalled()
})
it('finishes backup before bootstrap opens the database', async () => {
  ports.backup.mockImplementation(async () => {
    expect(ports.prepare).not.toHaveBeenCalled()
    return 'ready'
  })
  await expect(createLiveProfileStateStore(options)).rejects.toThrow('bootstrap reached')
  expect(ports.backup).toHaveBeenCalledWith(
    options.databaseFile,
    options.profileId,
    expect.any(Function)
  )
  expect(ports.prepare).toHaveBeenCalledOnce()
})
it('propagates read errors before bootstrap', async () => {
  ports.stat.mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }))
  await expect(createLiveProfileStateStore(options)).rejects.toThrow('denied')
  expect(ports.backup).not.toHaveBeenCalled()
  expect(ports.prepare).not.toHaveBeenCalled()
})
it('admits a fresh profile without attempting to back up a nonexistent database', async () => {
  ports.stat.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))
  await expect(createLiveProfileStateStore(options)).rejects.toThrow('bootstrap reached')
  expect(ports.backup).not.toHaveBeenCalled()
})

it('preserves newer-schema guidance without opening bootstrap', async () => {
  const error = new ProfileStateDatabaseOpenError('newer-schema', 'Use a newer release')
  ports.backup.mockRejectedValue(error)
  await expect(createLiveProfileStateStore(options)).rejects.toBe(error)
  expect(ports.prepare).not.toHaveBeenCalled()
})
it.each(['unreadable', 'identity-mismatch', 'invalid-profile-id'] as const)(
  'requests recovery for typed backup source failure %s before bootstrap',
  async (code) => {
    const error = new ProfileStateDatabaseOpenError(code, 'Cannot open saved state')
    ports.backup.mockRejectedValue(error)
    const result = createLiveProfileStateStore(options)
    await expect(result).rejects.toBeInstanceOf(ProfileStateRecoveryRequiredError)
    await expect(result).rejects.toMatchObject({ cause: error, databaseFile: options.databaseFile })
    expect(ports.prepare).not.toHaveBeenCalled()
  }
)
