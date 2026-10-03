import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { OrcaProfileIndex, OrcaProfileSummary } from '../../shared/orca-profiles'
import { ORCA_PROFILE_INDEX_SCHEMA_VERSION } from '../../shared/orca-profiles'
import {
  getOrcaProfileDirectory,
  getOrcaProfileIndexPath,
  readProfileIndex,
  writeProfileIndex
} from '../orca-profiles/profile-index-store'

function removeIfPresent(path: string): void {
  try {
    unlinkSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
}

function localizeProfile(profile: OrcaProfileSummary): OrcaProfileSummary {
  const { cloud: _legacyCloud, ...local } = profile
  return { ...local, kind: 'local' }
}

export function migrateLegacyOrcaCloudIdentity(userDataPath: string): void {
  const indexPath = getOrcaProfileIndexPath(userDataPath)
  if (!existsSync(indexPath)) {
    return
  }
  let raw: OrcaProfileIndex
  try {
    raw = JSON.parse(readFileSync(indexPath, 'utf8')) as OrcaProfileIndex
  } catch {
    // The profile store owns corrupt-index recovery; do not bypass its backup.
    return
  }
  if (!Array.isArray(raw.profiles)) {
    return
  }
  const validated = readProfileIndex(indexPath)
  if (!validated) {
    return
  }
  const needsMigration =
    raw.schemaVersion !== ORCA_PROFILE_INDEX_SCHEMA_VERSION ||
    validated.profiles.some(
      (profile) => profile.kind === 'cloud-linked' || profile.cloud !== undefined
    )
  if (!needsMigration) {
    return
  }
  const profiles = validated.profiles.map(localizeProfile)
  writeProfileIndex(indexPath, {
    schemaVersion: ORCA_PROFILE_INDEX_SCHEMA_VERSION,
    activeProfileId: validated.activeProfileId,
    profiles
  })
  for (const profile of profiles) {
    const directory = getOrcaProfileDirectory(profile.id, userDataPath)
    for (const name of [
      'account-session.json.enc',
      'account-session.json.enc.tmp',
      'account-session-mutation.json'
    ]) {
      removeIfPresent(join(directory, name))
    }
  }
}
