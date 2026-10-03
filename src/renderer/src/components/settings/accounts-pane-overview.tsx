import { Info, Loader2, Plus } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { ClaudeIcon, OpenAIIcon } from '../status-bar/icons'
import { SettingsSegmentedControl } from './SettingsFormControls'
import {
  providerAccountIsActiveInView,
  WSL_DEFAULT_DISTRO_KEY
} from './provider-account-visibility'
import type { AccountsPaneSectionModel, ProviderRosterLoadState } from './accounts-pane-types'
import { AccountsOfficialService } from './accounts-pane-official-service'
import {
  AccountsProviderSheet,
  type ProviderAccountSheetKind
} from './accounts-pane-provider-sheet'
import {
  AccountsCredentialsOverview,
  type CredentialSheetKind
} from './accounts-pane-credentials-overview'

function RuntimeScopeControl({ model }: { model: AccountsPaneSectionModel }): React.JSX.Element {
  if (model.isRemoteAccountScope) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          {model.remoteServerName || model.accountRuntime.label}
        </span>
        <span>
          {translate('auto.components.settings.AccountsPane.accountLocation', 'Account location')}
        </span>
        <Info className="size-3.5" />
      </div>
    )
  }
  if (!model.wslSupportedPlatform) {
    return (
      <span className="text-xs font-medium text-muted-foreground">
        {model.accountRuntime.label}
      </span>
    )
  }
  return (
    <div className="accounts-runtime-scope flex flex-wrap items-center justify-end gap-2">
      <span className="text-xs font-medium">
        {translate('auto.components.settings.AccountsPane.localScopeLabel', 'Local')}
      </span>
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        {translate('auto.components.settings.AccountsPane.accountLocation', 'Account location')}
        <Info className="size-3.5" />
      </span>
      <SettingsSegmentedControl
        ariaLabel={translate(
          'auto.components.settings.AccountsPane.46cf7e7495',
          'Account location'
        )}
        value={model.accountRuntime.runtime}
        onChange={(value) => model.updateSettings({ localAccountRuntime: value })}
        size="sm"
        options={[
          {
            value: 'host',
            label:
              model.localAccountRuntime.runtime === 'host'
                ? model.localAccountRuntime.label
                : translate('auto.components.settings.AccountsPane.windows', 'Windows')
          },
          {
            value: 'wsl',
            label: 'WSL',
            disabled: model.wslCapabilitiesLoading || !model.wslAvailable
          }
        ]}
      />
      {model.accountRuntime.runtime === 'wsl' ? (
        <Select
          value={model.accountRuntime.wslDistro ?? WSL_DEFAULT_DISTRO_KEY}
          onValueChange={(value) =>
            model.updateSettings({
              localAccountRuntime: 'wsl',
              localAccountWslDistro: value === WSL_DEFAULT_DISTRO_KEY ? null : value
            })
          }
          disabled={model.wslCapabilitiesLoading || !model.wslAvailable}
        >
          <SelectTrigger size="sm" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={WSL_DEFAULT_DISTRO_KEY}>
              {translate('auto.components.settings.AccountsPane.2358ac71d2', 'WSL default')}
            </SelectItem>
            {model.wslDistros.map((distro) => (
              <SelectItem key={distro} value={distro}>
                {distro}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  )
}

function countCopy(state: ProviderRosterLoadState, count: number): string {
  if (state === 'loading') {
    return translate('auto.components.settings.AccountsPane.loadingAccounts', 'Loading accounts…')
  }
  if (state === 'error') {
    return translate(
      'auto.components.settings.AccountsPane.accountsUnavailableShort',
      'Accounts unavailable'
    )
  }
  return translate(
    'auto.components.settings.AccountsPane.addedAccountCount',
    'Added accounts {{value0}}',
    { value0: count }
  )
}

function CliAccountCard({
  provider,
  model,
  onOpen,
  onRetry
}: {
  provider: ProviderAccountSheetKind
  model: AccountsPaneSectionModel
  onOpen: () => void
  onRetry: () => void
}): React.JSX.Element {
  const isCodex = provider === 'codex'
  const accounts = isCodex ? model.visibleCodexAccounts : model.visibleClaudeAccounts
  const loadState = isCodex ? model.codexAccountsLoadState : model.claudeAccountsLoadState
  const accountDataReady = loadState === 'loaded'
  const activeCodex =
    isCodex && accountDataReady
      ? model.visibleCodexAccounts.find((account) =>
          providerAccountIsActiveInView(
            account,
            model.codexAccounts,
            model.accountRuntime,
            model.accountVisibilityOptions
          )
        )
      : undefined
  const activeClaude =
    !isCodex && accountDataReady
      ? model.visibleClaudeAccounts.find((account) =>
          providerAccountIsActiveInView(
            account,
            model.claudeAccounts,
            model.accountRuntime,
            model.accountVisibilityOptions
          )
        )
      : undefined
  const active = activeCodex ?? activeClaude
  const systemActive = accountDataReady
    ? isCodex
      ? model.systemCodexActive
      : model.systemClaudeActive
    : false
  const action = isCodex ? model.codexAction : model.claudeAction
  const accountName = !accountDataReady
    ? loadState === 'error'
      ? translate(
          'auto.components.settings.AccountsPane.accountsUnavailableShort',
          'Accounts unavailable'
        )
      : translate('auto.components.settings.AccountsPane.loadingAccounts', 'Loading accounts…')
    : active
      ? (activeCodex?.workspaceLabel ?? activeClaude?.organizationName) ||
        translate('auto.components.settings.AccountsPane.savedAccount', 'Saved account')
      : isCodex && model.systemCodexIdentity?.email
        ? translate('auto.components.settings.AccountsPane.personalAccount', 'Personal account')
        : translate('auto.components.settings.AccountsPane.f2a265f8c7', 'System default')
  const accountDetail =
    active?.email ||
    (isCodex ? model.systemCodexIdentity?.email : null) ||
    translate(
      'auto.components.settings.AccountsPane.existingLogin',
      'Use the existing sign-in in {{value0}}',
      { value0: model.accountRuntime.label }
    )
  const add = (): void => {
    if (isCodex) {
      void model.runCodexAccountAction('adding', () =>
        window.api.codexAccounts.add({
          runtime: model.accountRuntime.runtime,
          wslDistro: model.accountRuntime.wslDistro
        })
      )
    } else {
      void model.runClaudeAccountAction('adding', () =>
        window.api.claudeAccounts.add({
          runtime: model.accountRuntime.runtime,
          wslDistro: model.accountRuntime.wslDistro
        })
      )
    }
  }
  const useDirectAdd =
    loadState === 'loaded' &&
    accounts.length === 0 &&
    !model.isRemoteAccountScope &&
    action === 'idle'
  const disabled =
    (action !== 'idle' && action !== 'adding') ||
    model.wslCapabilitiesLoading ||
    model.accountRuntimeUnavailable
  return (
    <article
      id={`accounts-${provider}`}
      className="flex min-h-48 flex-col rounded-xl border border-border/70 bg-card p-5"
    >
      <h4 className="flex items-center gap-3 text-lg font-semibold">
        {isCodex ? <OpenAIIcon size={24} /> : <ClaudeIcon size={24} />}
        {isCodex ? 'Codex' : 'Claude'}
      </h4>
      <div className="mt-5 min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-semibold">{accountName}</p>
          {active || systemActive ? (
            <Badge variant="secondary">
              {translate('auto.components.settings.AccountsPane.currentlyUsed', 'Currently used')}
            </Badge>
          ) : null}
        </div>
        <p
          className={cn(
            'mt-1 truncate text-sm text-muted-foreground',
            loadState === 'error' && 'text-destructive'
          )}
        >
          {accountDataReady ? accountDetail : model.accountRuntime.label}
        </p>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/60 pt-3">
        <span className="text-xs text-muted-foreground">
          {countCopy(loadState, accounts.length)}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={
            loadState === 'error'
              ? onRetry
              : useDirectAdd
                ? () => {
                    onOpen()
                    add()
                  }
                : onOpen
          }
          disabled={loadState !== 'error' && disabled}
        >
          {action === 'adding' ? (
            <Loader2 className="size-4 animate-spin" />
          ) : useDirectAdd ? (
            <Plus className="size-4" />
          ) : null}
          {loadState === 'error'
            ? translate('auto.components.settings.AccountsPane.retry', 'Retry')
            : useDirectAdd
              ? translate('auto.components.settings.AccountsPane.b0e948a4f9', 'Add Account')
              : translate(
                  'auto.components.settings.AccountsPane.manageAccounts',
                  'Manage accounts'
                )}
        </Button>
      </div>
    </article>
  )
}

export function AccountsPaneOverview({
  model,
  accountSheet,
  credentialSheet,
  onAccountSheetChange,
  onCredentialSheetChange,
  onRetryAccounts
}: {
  model: AccountsPaneSectionModel
  accountSheet: ProviderAccountSheetKind | null
  credentialSheet: CredentialSheetKind | null
  onAccountSheetChange: (sheet: ProviderAccountSheetKind | null) => void
  onCredentialSheetChange: (sheet: CredentialSheetKind | null) => void
  onRetryAccounts: () => void
}): React.JSX.Element {
  return (
    <div className="mx-auto max-w-[1040px] space-y-7">
      <AccountsOfficialService />
      <section aria-labelledby="accounts-cli-title" className="space-y-3">
        <div className="accounts-cli-heading flex flex-wrap items-end justify-between gap-4">
          <div>
            <h3 id="accounts-cli-title" className="text-lg font-semibold">
              {translate('auto.components.settings.AccountsPane.cliAccounts', 'CLI accounts')}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {translate(
                'auto.components.settings.AccountsPane.cliAccountsDescription',
                'Account and sign-in status are managed independently for each device and runtime environment.'
              )}
            </p>
          </div>
          <RuntimeScopeControl model={model} />
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(22rem,100%),1fr))] gap-3">
          <CliAccountCard
            provider="claude"
            model={model}
            onOpen={() => onAccountSheetChange('claude')}
            onRetry={onRetryAccounts}
          />
          <CliAccountCard
            provider="codex"
            model={model}
            onOpen={() => onAccountSheetChange('codex')}
            onRetry={onRetryAccounts}
          />
        </div>
      </section>
      <AccountsCredentialsOverview
        model={model}
        sheet={credentialSheet}
        onSheetChange={onCredentialSheetChange}
      />
      <AccountsProviderSheet
        kind="claude"
        model={model}
        open={accountSheet === 'claude'}
        onOpenChange={(open) => onAccountSheetChange(open ? 'claude' : null)}
      />
      <AccountsProviderSheet
        kind="codex"
        model={model}
        open={accountSheet === 'codex'}
        onOpenChange={(open) => onAccountSheetChange(open ? 'codex' : null)}
      />
    </div>
  )
}
