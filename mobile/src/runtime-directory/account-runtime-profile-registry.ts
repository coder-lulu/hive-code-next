import type { HostProfile } from '../transport/types'

let accountProfiles: readonly HostProfile[] = []

export function replaceAccountRuntimeProfiles(profiles: readonly HostProfile[]): void {
  accountProfiles = [...profiles]
}

export function clearAccountRuntimeProfiles(): void {
  accountProfiles = []
}

export function findAccountRuntimeProfile(hostId: string): HostProfile | undefined {
  return accountProfiles.find((profile) => profile.id === hostId)
}

export function mergeAccountRuntimeProfiles(localProfiles: HostProfile[]): HostProfile[] {
  if (accountProfiles.length === 0) {
    return localProfiles
  }
  const merged = [...localProfiles]
  const localIndexByRuntimeId = new Map<string, number>()
  merged.forEach((profile, index) => {
    if (profile.runtimeRecordId) {
      localIndexByRuntimeId.set(profile.runtimeRecordId, index)
    }
  })
  for (const accountProfile of accountProfiles) {
    const runtimeRecordId = accountProfile.runtimeRecordId
    const localIndex = runtimeRecordId ? localIndexByRuntimeId.get(runtimeRecordId) : undefined
    if (localIndex === undefined) {
      merged.push(accountProfile)
      continue
    }
    const local = merged[localIndex]!
    if (accountProfile.accountRuntime) {
      merged[localIndex] = {
        ...local,
        accountRuntimeFallback: accountProfile.accountRuntime
      }
    }
  }
  return merged
}

export function resetAccountRuntimeProfileRegistryForTests(): void {
  accountProfiles = []
}
