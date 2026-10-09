import { compareProductVersions, isProductVersion } from './product-version'
import { APP_DISPLAY_NAME } from './brand'

// Both reviewed public roots require SQLite profile authority at this owned version.
export const SQLITE_PROFILE_RELEASE_FLOOR = '1.5.0-beta.24'

export function profileStateBuildCompatibilityError(
  currentVersion: string,
  targetVersion: string
): string | null {
  if (
    isProductVersion(currentVersion) &&
    isProductVersion(targetVersion) &&
    compareProductVersions(currentVersion, SQLITE_PROFILE_RELEASE_FLOOR) >= 0 &&
    compareProductVersions(targetVersion, SQLITE_PROFILE_RELEASE_FLOOR) >= 0
  ) {
    return null
  }
  return `This build does not meet ${APP_DISPLAY_NAME}'s reviewed SQLite profile baseline. Select a current ${APP_DISPLAY_NAME} build. Back up every profile before any manual recovery.`
}
