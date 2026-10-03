/** Values used by the home composer to distinguish a project selection from a workspace. */
export const DESKTOP_HOME_PROJECT_SELECTION_PREFIX = 'project:'

export function desktopHomeProjectSelectionValue(identityKey: string): string {
  return `${DESKTOP_HOME_PROJECT_SELECTION_PREFIX}${identityKey}`
}

export function desktopHomeProjectIdentityFromSelection(value: string): string | null {
  return value.startsWith(DESKTOP_HOME_PROJECT_SELECTION_PREFIX)
    ? value.slice(DESKTOP_HOME_PROJECT_SELECTION_PREFIX.length)
    : null
}
