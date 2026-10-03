import type { HiveAccountRuntimeDirectoryService } from './hive-account-runtime-directory-service'
import type { HiveAccountRuntimeTransport } from './hive-account-runtime-transport'

export type HiveAccountRuntimeAccess = Readonly<{
  getLocalRuntimeRecordId: () => string | null
  directory: Pick<HiveAccountRuntimeDirectoryService, 'getState'>
  transport: Pick<HiveAccountRuntimeTransport, 'getStatus' | 'call' | 'subscribe' | 'disconnect'>
}>

let processAccess: HiveAccountRuntimeAccess | null = null

/** Installs the main-process-only account Runtime route; no secrets cross preload. */
export function installHiveAccountRuntimeAccess(access: HiveAccountRuntimeAccess): () => void {
  processAccess = access
  return () => {
    if (processAccess === access) {
      processAccess = null
    }
  }
}

export function getHiveAccountRuntimeAccess(): HiveAccountRuntimeAccess | null {
  return processAccess
}
