import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  ACTIVE_VIEW_FILE,
  assertExistingSafeDirectory,
  DATA_FILE,
  MAX_ACTIVE_VIEW_BYTES,
  MAX_PROFILE_DATA_BYTES,
  PROFILE_INDEX_FILE,
  PROFILES_DIRECTORY,
  readControlFile,
  readSafeFile,
  sha256,
  type MigrationManifest
} from './user-data-migration-journal'

export function targetIndexMatches(target: string, manifest: MigrationManifest): boolean {
  try {
    return sha256(readControlFile(join(target, PROFILE_INDEX_FILE))) === manifest.profileIndexSha256
  } catch {
    return false
  }
}

export function targetProfilesMatch(target: string, manifest: MigrationManifest): boolean {
  const profilesDirectory = join(target, PROFILES_DIRECTORY)
  try {
    assertExistingSafeDirectory(profilesDirectory)
    const expectedProfileIds = new Set(manifest.profiles.map((profile) => profile.id))
    const profileEntries = readdirSync(profilesDirectory, { withFileTypes: true })
    if (
      profileEntries.length !== expectedProfileIds.size ||
      profileEntries.some((entry) => !entry.isDirectory() || !expectedProfileIds.has(entry.name))
    ) {
      return false
    }
    for (const profile of manifest.profiles) {
      const profileDirectory = join(profilesDirectory, profile.id)
      assertExistingSafeDirectory(profileDirectory)
      const expectedFiles = new Set([
        DATA_FILE,
        ...(profile.activeViewSha256 ? [ACTIVE_VIEW_FILE] : [])
      ])
      const profileFiles = readdirSync(profileDirectory, { withFileTypes: true })
      if (
        profileFiles.length !== expectedFiles.size ||
        profileFiles.some((entry) => !entry.isFile() || !expectedFiles.has(entry.name))
      ) {
        return false
      }
      if (
        sha256(readSafeFile(join(profileDirectory, DATA_FILE), MAX_PROFILE_DATA_BYTES)) !==
        profile.dataSha256
      ) {
        return false
      }
      if (profile.activeViewSha256) {
        const activeView = readSafeFile(
          join(profileDirectory, ACTIVE_VIEW_FILE),
          MAX_ACTIVE_VIEW_BYTES
        )
        if (sha256(activeView) !== profile.activeViewSha256) {
          return false
        }
      }
    }
    return true
  } catch {
    return false
  }
}

export function targetArtifactsMatch(
  target: string,
  manifest: MigrationManifest
): 'match' | 'missing' | 'conflict' {
  const indexExists = existsSync(join(target, PROFILE_INDEX_FILE))
  const profilesExist = existsSync(join(target, PROFILES_DIRECTORY))
  if (existsSync(join(target, DATA_FILE))) {
    return 'conflict'
  }
  if (indexExists && !targetIndexMatches(target, manifest)) {
    return 'conflict'
  }
  if (profilesExist && !targetProfilesMatch(target, manifest)) {
    return 'conflict'
  }
  return indexExists && profilesExist ? 'match' : 'missing'
}
