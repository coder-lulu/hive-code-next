import { translate } from '@/i18n/i18n'
import { selectCodexProviderAccount } from '@/runtime/runtime-provider-accounts-client'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import type { AccountsPaneSectionModel } from './accounts-pane-types'
import { formatAccountTimestamp } from './accounts-pane-runtime'
import {
  getProviderAccountRuntime,
  providerAccountIsActiveInView
} from './provider-account-visibility'
import {
  AccountActionMenu,
  AccountAvatar,
  AccountLoadState,
  EmptyAccounts
} from './accounts-pane-sheet-account-controls'

export function CodexAccountsSheetList({
  model
}: {
  model: AccountsPaneSectionModel
}): React.JSX.Element {
  if (model.codexAccountsLoadState !== 'loaded') {
    return <AccountLoadState state={model.codexAccountsLoadState} />
  }
  if (model.visibleCodexAccounts.length === 0) {
    return <EmptyAccounts />
  }
  return (
    <div className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/70">
      {model.visibleCodexAccounts.map((account) => {
        const runtime = getProviderAccountRuntime(account)
        const active = providerAccountIsActiveInView(
          account,
          model.codexAccounts,
          model.accountRuntime,
          model.accountVisibilityOptions
        )
        const busy = model.codexAction !== 'idle' || model.accountRuntimeUnavailable
        return (
          <div key={account.id} className="flex items-center gap-3 px-4 py-3">
            <AccountAvatar value={account.email} />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold">
                  {account.workspaceLabel || account.email}
                </p>
                {active ? (
                  <Badge variant="secondary">
                    {translate('auto.components.settings.AccountsPane.e74831fb6b', 'Active')}
                  </Badge>
                ) : null}
              </div>
              {account.workspaceLabel ? (
                <p className="truncate text-xs text-muted-foreground">{account.email}</p>
              ) : null}
              <p className="mt-1 text-[11px] text-muted-foreground">
                {translate(
                  'auto.components.settings.AccountsPane.lastVerified',
                  'Last verified: {{value0}}',
                  { value0: formatAccountTimestamp(account.lastAuthenticatedAt) }
                )}
              </p>
            </div>
            {!active ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void model.runCodexAccountAction(
                    `select:${account.id}`,
                    () =>
                      selectCodexProviderAccount(model.settings, {
                        accountId: account.id,
                        ...runtime
                      }),
                    runtime
                  )
                }
              >
                {translate('auto.components.settings.AccountsPane.switchToAccount', 'Switch')}
              </Button>
            ) : null}
            <AccountActionMenu
              busy={busy}
              reauthDisabled={model.isRemoteAccountScope || busy}
              onReauthenticate={() =>
                void model.runCodexAccountAction(
                  `reauth:${account.id}`,
                  () => window.api.codexAccounts.reauthenticate({ accountId: account.id }),
                  runtime
                )
              }
              onRemove={() =>
                model.setRemoveCodexTarget({
                  id: account.id,
                  ownerKey: model.accountScopeKey,
                  runtime,
                  label: account.email,
                  scopeLabel:
                    runtime.runtime === 'wsl'
                      ? `WSL ${runtime.wslDistro || ''}`.trim()
                      : model.remoteServerName || model.accountRuntime.label,
                  isActive: active
                })
              }
            />
          </div>
        )
      })}
    </div>
  )
}
