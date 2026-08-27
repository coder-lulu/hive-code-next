export type SettingsHelpPlacement = 'main-strip' | 'shell-overlay' | 'right-sidebar'

export function resolveSettingsHelpPlacement(input: {
  creationLayoutActive: boolean
  mainStripMounted: boolean
  workspaceChromeActive: boolean
  rightSidebarVisible: boolean
}): SettingsHelpPlacement {
  if (input.creationLayoutActive) {
    return 'shell-overlay'
  }
  if (!input.workspaceChromeActive) {
    return input.mainStripMounted ? 'main-strip' : 'shell-overlay'
  }
  return input.rightSidebarVisible ? 'right-sidebar' : 'shell-overlay'
}
