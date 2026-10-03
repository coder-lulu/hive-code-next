import { app, dialog, type BrowserWindow } from 'electron'
import { APP_DISPLAY_NAME } from '../../shared/brand'
import { getCanonicalUserDataPath } from '../persistence'
import {
  completeUserDataMigration,
  migrateUserDataFromOrca,
  validateUserDataMigration
} from './hivecode-user-data-migration'
import { resolveUserDataMigrationStartupAction } from './user-data-migration-startup-policy'

let userDataMigrationNeedsValidation = false
let userDataMigrationNeedsCompletion = false
let userDataMigrationSkippedUnsafeSource = false

export function prepareUserDataMigration(): void {
  // Why: build a sanitized, copy-only profile snapshot before Store loads. The
  // prepared marker is validated after Store construction and completed only
  // after startup services initialize, so interrupted starts remain recoverable.
  if (app.isPackaged) {
    const migrationResult = migrateUserDataFromOrca({
      hiveCodeUserData: getCanonicalUserDataPath()
    })
    const migrationAction = resolveUserDataMigrationStartupAction(migrationResult)
    if (migrationResult.migrated) {
      console.log(`[hivecode] Prepared ${migrationResult.copiedCount} sanitized migration files`)
    }
    if (migrationAction === 'validate-and-complete') {
      userDataMigrationNeedsValidation = true
      userDataMigrationNeedsCompletion = true
    } else if (migrationAction === 'complete') {
      userDataMigrationNeedsCompletion = true
    } else if (migrationAction === 'start-clean') {
      userDataMigrationSkippedUnsafeSource = true
      console.warn('[hivecode] Legacy user data migration skipped: unsafe-source')
    } else if (migrationAction === 'block' && !migrationResult.migrated) {
      // Why: continuing would create or mutate target profile data and could
      // make a safe retry impossible. Do not expose filesystem paths in errors.
      throw new Error(
        `[hivecode] User data migration blocked startup: ${migrationResult.reason}:${migrationResult.errorCode ?? 'none'}`
      )
    }
  }
}

export function validatePreparedUserDataMigration(): void {
  if (userDataMigrationNeedsValidation) {
    if (!validateUserDataMigration(getCanonicalUserDataPath())) {
      throw new Error('[hivecode] Could not validate prepared user data migration')
    }
    userDataMigrationNeedsValidation = false
  }
}

export function completePendingUserDataMigration(): void {
  if (!userDataMigrationNeedsCompletion) {
    return
  }
  if (completeUserDataMigration(getCanonicalUserDataPath())) {
    userDataMigrationNeedsCompletion = false
    return
  }
  // Why: target data is already Store-validated. Keep the validated marker so
  // the next launch can retry completion without restoring old bytes.
  console.warn('[hivecode] User data migration completion remains pending')
}

export function showUserDataMigrationWarning(win: BrowserWindow): void {
  if (userDataMigrationSkippedUnsafeSource) {
    userDataMigrationSkippedUnsafeSource = false
    const showMigrationWarning = (): void => {
      void dialog
        .showMessageBox(win, {
          type: 'warning',
          buttons: ['OK'],
          defaultId: 0,
          title: `${APP_DISPLAY_NAME} started with a new profile`,
          message: 'Data from an older app version could not be imported safely.',
          detail: `Your existing data was not changed. ${APP_DISPLAY_NAME} started with a new local profile instead.`
        })
        .catch((error) => {
          console.warn(
            '[hivecode] Could not show legacy data migration warning:',
            error instanceof Error ? error.message : String(error)
          )
        })
    }
    if (win.isVisible()) {
      showMigrationWarning()
    } else {
      win.once('show', showMigrationWarning)
    }
  }
}
