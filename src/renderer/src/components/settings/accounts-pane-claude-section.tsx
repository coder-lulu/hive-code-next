import { canOfferClaudeSignInLink, withCopiedClaudeLink } from './claude-sign-in-link-menu'
import { translate } from '@/i18n/i18n'
import { selectClaudeProviderAccount } from '@/runtime/runtime-provider-accounts-client'
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

export function ClaudeAccountsSheetList({
  model
}: {
  model: AccountsPaneSectionModel
}): React.JSX.Element {
  if (model.claudeAccountsLoadState !== 'loaded') {
    return <AccountLoadState state={model.claudeAccountsLoadState} />
  }
  if (model.visibleClaudeAccounts.length === 0) {
    return <EmptyAccounts />
  }
  const systemEmail =
    model.accountRuntime.runtime === 'host'
      ? model.claudeAccounts.systemDefaultEmail?.trim()
      : undefined
  const copiedSystemLogin =
    !model.isRemoteAccountScope &&
    model.accountRuntime.runtime === 'host' &&
    model.claudeAccounts.systemDefaultMayBeCopied &&
    !model.settings.claudeCopiedSystemDefaultNoticeDismissed &&
    systemEmail &&
    model.visibleClaudeAccounts.some(
      (account) => account.email.toLocaleLowerCase() === systemEmail.toLocaleLowerCase()
    )
  return (
    <>
      {systemEmail ? (
        <p className="text-xs text-muted-foreground">
          {translate('accounts.claude.systemDefaultNamed', 'System default: {{value0}}', {
            value0: systemEmail
          })}
        </p>
      ) : null}
      {copiedSystemLogin ? (
        <div className="rounded-lg border border-border/70 p-3 text-sm">
          {translate(
            'accounts.claude.systemDefaultIsSaved',
            'System default is signed in as {{value0}}, which is also a saved account. An earlier HiveCode version may have copied that login there. If it is not your own login, select System default and run claude /login.',
            { value0: systemEmail }
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => model.updateSettings({ claudeCopiedSystemDefaultNoticeDismissed: true })}
          >
            {translate('accounts.claude.systemDefaultIsSavedDismiss', 'Dismiss')}
          </Button>
        </div>
      ) : null}
      <div className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/70">
        {model.visibleClaudeAccounts.map((account) => {
          const runtime = getProviderAccountRuntime(account)
          const active = providerAccountIsActiveInView(
            account,
            model.claudeAccounts,
            model.accountRuntime,
            model.accountVisibilityOptions
          )
          const busy = model.claudeAction !== 'idle' || model.accountRuntimeUnavailable
          return (
            <div key={account.id} className="flex items-center gap-3 px-4 py-3">
              <AccountAvatar value={account.email} />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold">
                    {account.organizationName || account.email}
                  </p>
                  {active ? (
                    <Badge variant="secondary">
                      {translate('auto.components.settings.AccountsPane.e74831fb6b', 'Active')}
                    </Badge>
                  ) : null}
                </div>
                {account.organizationName ? (
                  <p className="truncate text-xs text-muted-foreground">{account.email}</p>
                ) : null}
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {account.needsSignIn
                    ? translate(
                        'accounts.claude.signInRequired',
                        'Sign in again to use this account'
                      )
                    : translate(
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
                  disabled={busy || account.needsSignIn}
                  onClick={() =>
                    void model.runClaudeAccountAction(
                      `select:${account.id}`,
                      () =>
                        selectClaudeProviderAccount(model.accountOwner, {
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
                  void model.runClaudeAccountAction(
                    `reauth:${account.id}`,
                    () => window.api.claudeAccounts.reauthenticate({ accountId: account.id }),
                    runtime
                  )
                }
                onCopySignInLink={
                  canOfferClaudeSignInLink(runtime.runtime)
                    ? () =>
                        void model.runClaudeAccountAction(
                          `reauth:${account.id}`,
                          () =>
                            withCopiedClaudeLink(
                              true,
                              window.api.claudeAccounts.reauthenticate({
                                accountId: account.id,
                                copyLink: true
                              })
                            ),
                          runtime
                        )
                    : undefined
                }
                onRemove={() =>
                  model.setRemoveClaudeTarget({
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
    </>
  )
}
