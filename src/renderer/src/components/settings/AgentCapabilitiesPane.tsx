import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { OrchestrationPane } from './OrchestrationPane'
import './agent-capabilities.css'

export function AgentCapabilitiesPane({
  settings,
  updateSettings,
  showComputerUse,
  navigationTargetSectionId
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
  showComputerUse: boolean
  navigationTargetSectionId?: string | null
}): React.JSX.Element {
  return (
    <div className="agent-capabilities-grid">
      <OrchestrationPane
        embedded
        showComputerUse={showComputerUse}
        settings={settings}
        updateSettings={updateSettings}
        navigationTargetSectionId={navigationTargetSectionId}
      />
    </div>
  )
}
