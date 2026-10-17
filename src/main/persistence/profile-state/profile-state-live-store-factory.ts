import { lstat } from 'node:fs/promises'
import { ProfileStateDatabaseOpenError } from './profile-state-database-errors'
import { ProfileStateRecoveryRequiredError } from './profile-state-recovery-required'
import { ensureProfileStatePreMigrationBackup } from './profile-state-pre-migration-backup'
import { runProfileStateBackup } from './profile-state-backup-worker'
import { Store } from '../loading-store/store'
import {
  prepareProfileStateStore,
  type ProfileStateStoreFactoryOptions,
  type ProfileStateStoreFactoryResult
} from './profile-state-store-factory'
import { ProfileStateWorkerAuthority } from './profile-state-worker-authority'

/** Publish live state only after its exact bootstrap revision has a worker owner. */
export async function createLiveProfileStateStore(
  options: ProfileStateStoreFactoryOptions,
  workerOptions: {
    workerPath?: string
    backupWorkerPath?: string
    onFailure?: (error: Error) => void
    onSaveDelayChanged?: (delayed: boolean) => void
  } = {}
): Promise<ProfileStateStoreFactoryResult> {
  // Back up before bootstrap opens/migrates SQLite or Store normalizes and schedules writes.
  // A fresh/JSON-only profile has no SQLite state yet; its import owns source preservation.
  const existingDatabase = await lstat(options.databaseFile).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }
    throw error
  })
  try {
    if (existingDatabase !== undefined) {
      if (
        !existingDatabase.isFile() ||
        (await ensureProfileStatePreMigrationBackup(
          options.databaseFile,
          options.profileId,
          (job) => runProfileStateBackup(job, undefined, workerOptions.backupWorkerPath)
        )) !== 'ready'
      ) {
        throw new Error('Profile state pre-migration backup failed; saved data was not rewritten')
      }
    }
  } catch (error) {
    if (error instanceof ProfileStateDatabaseOpenError && error.code !== 'newer-schema') {
      throw new ProfileStateRecoveryRequiredError(options, error)
    }
    throw error
  }
  const { initialState: initial, ...prepared } = prepareProfileStateStore(options)

  // Consume before retirement: the bootstrap snapshot carries the original revision fence.
  const parsed = initial.takeParsedState?.()
  const serializedState = initial.serializedState
  const authority = new ProfileStateWorkerAuthority(
    initial.authority.retireForWorker(),
    workerOptions
  )
  try {
    await authority.ready
    const initialAuthorityState = initial.takeParsedState
      ? { authority, takeParsedState: () => parsed }
      : { authority, serializedState }
    return {
      ...prepared,
      store: new Store({
        dataFile: options.dataFile,
        storageAuthority: options.storageAuthority,
        profileStateAuthority: authority,
        initialAuthorityState: {
          ...initialAuthorityState,
          unboundPaneAliases: initial.unboundPaneAliases
        }
      })
    }
  } catch (error) {
    try {
      await authority.close()
    } catch (closeError) {
      console.error('[persistence] Failed to close a refused profile writer:', closeError)
    }
    throw error
  }
}
