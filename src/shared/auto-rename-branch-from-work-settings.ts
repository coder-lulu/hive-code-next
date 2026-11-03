import type { GlobalSettings } from './global-settings-types'

type AutoRenameBranchFromWorkSettings = Pick<GlobalSettings, 'autoRenameBranchFromWork'>

export function normalizeAutoRenameBranchFromWorkDefaultOn(
  settings: Partial<AutoRenameBranchFromWorkSettings> | undefined
): AutoRenameBranchFromWorkSettings {
  return { autoRenameBranchFromWork: settings?.autoRenameBranchFromWork ?? true }
}
