import { translate } from '@/i18n/i18n'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'
import type { AccountsPaneSectionModel } from './accounts-pane-types'
import { AntigravityAccountsSection } from './AntigravityAccountsSection'
import { ManagedDataAccountsSection } from './ManagedDataAccountsSection'

export function AccountsHostOwnedSections({
  model
}: {
  model: AccountsPaneSectionModel
}): React.JSX.Element {
  const environmentId = model.settings.activeRuntimeEnvironmentId?.trim()
  const owner: RuntimeClientTarget | null = model.isRemoteAccountScope
    ? environmentId
      ? { kind: 'environment', environmentId }
      : null
    : { kind: 'local' }
  if (model.accountRuntimeUnavailable || !owner) {
    return (
      <p role="alert" className="text-xs text-destructive">
        {translate(
          'auto.components.settings.AccountsPane.accountsUnavailableShort',
          'Accounts unavailable'
        )}
      </p>
    )
  }
  return (
    <div key={model.accountScopeKey} className="space-y-6">
      {model.accountRuntime.runtime === 'host' ? (
        <div className="grid gap-6 sm:grid-cols-2">
          <ManagedDataAccountsSection provider="opencode" target={owner} />
          <ManagedDataAccountsSection provider="devin" target={owner} />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {translate(
            'accounts.managedData.wslUnavailable',
            'Managed OpenCode and Devin accounts are unavailable for this WSL runtime. Launches use its own credentials.'
          )}
        </p>
      )}
      <AntigravityAccountsSection
        owner={owner}
        target={{
          runtime: model.accountRuntime.runtime,
          wslDistro: model.accountRuntime.wslDistro ?? null
        }}
        label={model.accountRuntime.label}
      />
    </div>
  )
}
