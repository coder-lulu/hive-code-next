import { MiniMaxAccountsSection } from './MiniMaxAccountsSection'
import type { AccountsPaneSectionModel } from './accounts-pane-types'

export function renderMiniMaxAccountsSection(model: AccountsPaneSectionModel): React.JSX.Element {
  return (
    <MiniMaxAccountsSection
      key={model.accountScopeKey}
      host={{ owner: model.accountOwner, label: model.remoteServerName }}
      usageSettings={model.usageHostSettings}
      miniMaxRateLimits={model.miniMaxRateLimits}
      recordFeatureInteraction={model.recordFeatureInteraction}
    />
  )
}
