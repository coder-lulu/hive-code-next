import { translate } from '@/i18n/i18n'
import { isWebClientLocation } from '@/lib/web-client-location'
import { getRemoteAccountsPaneScope } from './provider-account-scope'
import { ProviderHostScopeControl } from './ProviderHostScopeControl'

export function renderAccountsRemoteScopeNotice(
  isRemoteAccountScope: boolean,
  remoteServerName: string | null
): React.JSX.Element | null {
  // Why: users read the remote-scoped list as their desktop accounts being
  // deleted (#8186); say they are intact and link the default-runtime control.
  // The web client has no desktop-owned accounts and cannot select Local
  // desktop, so promising a switch back would be a dead end there.
  return isRemoteAccountScope && !isWebClientLocation() ? (
    <ProviderHostScopeControl
      labelPrefix={translate(
        'auto.components.settings.AccountsPane.accountScopePrefix',
        'Account scope'
      )}
      scope={getRemoteAccountsPaneScope(remoteServerName)}
      className="text-xs"
    />
  ) : null
}
