import * as hostListLoads from './host-list-load-sharing'
import { readStoredHostProfilesForMutation, writeStoredHostProfiles } from './host-metadata-store'
import { RuntimeRecordIdSchema } from './types'

export class HostRuntimeIdentityMismatchError extends Error {
  constructor() {
    super('Authenticated Runtime identity does not match the paired host')
  }
}

export async function commitAuthenticatedRuntimeRecordId(
  hostId: string,
  runtimeRecordId: string
): Promise<boolean> {
  const parsed = RuntimeRecordIdSchema.safeParse(runtimeRecordId)
  if (!parsed.success) {
    throw new HostRuntimeIdentityMismatchError()
  }
  const hosts = await readStoredHostProfilesForMutation()
  const index = hosts.findIndex((host) => host.id === hostId)
  if (index === -1) {
    return false
  }
  const host = hosts[index]!
  if (host.runtimeRecordId && host.runtimeRecordId !== parsed.data) {
    throw new HostRuntimeIdentityMismatchError()
  }
  if (host.runtimeRecordId === parsed.data) {
    return false
  }
  const next = hosts.slice()
  next[index] = { ...host, runtimeRecordId: parsed.data }
  await writeStoredHostProfiles(next)
  hostListLoads.dropSharedHostListLoad()
  return true
}
