export type UserDataMigrationStartupAction =
  | 'continue'
  | 'validate-and-complete'
  | 'complete'
  | 'start-clean'
  | 'block'

type UserDataMigrationStartupResult = {
  migrated: boolean
  reason?: string
}

export function resolveUserDataMigrationStartupAction(
  result: UserDataMigrationStartupResult
): UserDataMigrationStartupAction {
  if (result.migrated || result.reason === 'awaiting-validation') {
    return 'validate-and-complete'
  }
  if (result.reason === 'awaiting-completion') {
    return 'complete'
  }
  if (result.reason === 'unsafe-source') {
    return 'start-clean'
  }
  if (
    result.reason === 'already-migrated' ||
    result.reason === 'no-orca-data' ||
    result.reason === 'existing-target-data'
  ) {
    return 'continue'
  }
  return 'block'
}
