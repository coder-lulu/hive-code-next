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
  // The landing page's context rail owns a real titlebar too. Keep settings/help
  // beside its title and close control whenever that rail is visible; otherwise
  // the shell overlay is anchored to the center column and appears stranded near
  // the middle of the window (especially on the desktop home screen).
  if (input.rightSidebarVisible) {
    return 'right-sidebar'
  }
  if (!input.workspaceChromeActive) {
    return input.mainStripMounted ? 'main-strip' : 'shell-overlay'
  }
  return 'shell-overlay'
}
