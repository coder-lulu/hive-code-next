import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import type { PresenceDependencies } from './hive-runtime-cloud-presence-support'

type PresenceAuthorizationMigration = Readonly<{
  authorization: HiveRuntimeCloudAuthorization
  userDataPath: string
  dependencies: PresenceDependencies
}>

/**
 * Migrates a claimed Runtime from its provisional authority to the signed-in
 * authority without coupling heartbeat lifetime to the account session.
 */
export function migrateHiveRuntimeCloudPresenceAuthorization({
  authorization,
  userDataPath,
  dependencies
}: PresenceAuthorizationMigration): boolean {
  const stored = dependencies.readState(userDataPath)
  if (
    stored.status !== 'ok' ||
    stored.value.status !== 'CLAIMED' ||
    stored.value.ownerAccountId !== authorization.accountId ||
    stored.value.authorityId === authorization.authorityId
  ) {
    return false
  }
  return dependencies.saveState(userDataPath, {
    ...stored.value,
    authorityId: authorization.authorityId
  })
}
