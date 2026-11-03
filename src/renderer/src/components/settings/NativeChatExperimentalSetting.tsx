import type { GlobalSettings } from '../../../../shared/global-settings-types'

/** Retired compatibility surface: Chat settings live on the always-available Chat page. */
export function NativeChatExperimentalSetting(_props: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element | null {
  return null
}
