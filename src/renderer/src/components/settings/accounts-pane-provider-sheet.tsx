import { AlertTriangle, Loader2, Plus, Terminal, X } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import {
  selectClaudeProviderAccount,
  selectCodexProviderAccount
} from '@/runtime/runtime-provider-accounts-client'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet'
import { ClaudeIcon, OpenAIIcon } from '../status-bar/icons'
import { getCodexSystemDefaultSubtitle } from './accounts-pane-runtime'
import type { AccountsPaneSectionModel } from './accounts-pane-types'
import { ClaudeAccountsSheetList } from './accounts-pane-claude-section'
import { CodexAccountsSheetList } from './accounts-pane-codex-account-row'

export type ProviderAccountSheetKind = 'claude' | 'codex'

function SystemAccountRow({
  kind,
  model
}: {
  kind: ProviderAccountSheetKind
  model: AccountsPaneSectionModel
}): React.JSX.Element {
  const isCodex = kind === 'codex'
  const loadState = isCodex ? model.codexAccountsLoadState : model.claudeAccountsLoadState
  const active =
    loadState === 'loaded' && (isCodex ? model.systemCodexActive : model.systemClaudeActive)
  const action = isCodex ? model.codexAction : model.claudeAction
  const select = (): void => {
    const selection = {
      accountId: null,
      runtime: model.accountRuntime.runtime,
      wslDistro: model.accountRuntime.wslDistro
    }
    if (isCodex) {
      void model.runCodexAccountAction('select:system', () =>
        selectCodexProviderAccount(model.settings, selection)
      )
    } else {
      void model.runClaudeAccountAction('select:system', () =>
        selectClaudeProviderAccount(model.settings, selection)
      )
    }
  }
  const subtitle = isCodex
    ? getCodexSystemDefaultSubtitle(model.systemCodexIdentity, model.accountRuntimeSentenceLabel)
    : translate(
        'auto.components.settings.AccountsPane.systemClaudeDescription',
        'Use the existing Claude sign-in in {{value0}}.',
        { value0: model.accountRuntimeSentenceLabel }
      )
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/70 px-4 py-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
        <Terminal className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold">
            {translate('auto.components.settings.AccountsPane.f2a265f8c7', 'System default')}
          </p>
          {active ? (
            <Badge variant="secondary">
              {translate('auto.components.settings.AccountsPane.e74831fb6b', 'Active')}
            </Badge>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {!active ? (
        <Button
          variant="outline"
          size="sm"
          onClick={select}
          disabled={loadState !== 'loaded' || action !== 'idle' || model.accountRuntimeUnavailable}
        >
          {translate('auto.components.settings.AccountsPane.switchToAccount', 'Switch')}
        </Button>
      ) : null}
    </div>
  )
}

export function AccountsProviderSheet({
  kind,
  model,
  open,
  onOpenChange
}: {
  kind: ProviderAccountSheetKind
  model: AccountsPaneSectionModel
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const isCodex = kind === 'codex'
  const action = isCodex ? model.codexAction : model.claudeAction
  const adding = action === 'adding'
  const addDisabled =
    model.isRemoteAccountScope ||
    (isCodex ? model.codexAccountsLoadState : model.claudeAccountsLoadState) !== 'loaded' ||
    action !== 'idle' ||
    model.wslCapabilitiesLoading ||
    model.accountRuntimeUnavailable
  const loadState = isCodex ? model.codexAccountsLoadState : model.claudeAccountsLoadState
  const accountCount = isCodex
    ? model.visibleCodexAccounts.length
    : model.visibleClaudeAccounts.length
  const add = (): void => {
    const input = {
      runtime: model.accountRuntime.runtime,
      wslDistro: model.accountRuntime.wslDistro
    }
    if (isCodex) {
      void model.runCodexAccountAction('adding', () => window.api.codexAccounts.add(input))
    } else {
      void model.runClaudeAccountAction('adding', () => window.api.claudeAccounts.add(input))
    }
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-[560px]">
        <SheetHeader className="border-b border-border/60 px-8 py-7 pr-14">
          <SheetTitle className="flex items-center gap-3 text-xl">
            {isCodex ? <OpenAIIcon size={28} /> : <ClaudeIcon size={28} />}
            {isCodex
              ? translate(
                  'auto.components.settings.AccountsPane.codexAccountTitle',
                  'Codex accounts'
                )
              : translate(
                  'auto.components.settings.AccountsPane.claudeAccountTitle',
                  'Claude accounts'
                )}
          </SheetTitle>
          <SheetDescription className="pt-4">
            <span className="block font-medium text-foreground">
              {model.isRemoteAccountScope
                ? model.remoteServerName || model.accountRuntime.label
                : translate(
                    'auto.components.settings.AccountsPane.localScope',
                    'Local / {{value0}}',
                    { value0: model.accountRuntime.label }
                  )}
            </span>
            <span className="mt-1 block">
              {model.isRemoteAccountScope
                ? translate(
                    'auto.components.settings.AccountsPane.remoteSheetDescription',
                    'Select an account stored on this remote server. Add and re-authenticate accounts on that server.'
                  )
                : translate(
                    'auto.components.settings.AccountsPane.localSheetDescription',
                    'Choose the account used in this environment. Sign-in data stays in this environment.'
                  )}
            </span>
          </SheetDescription>
        </SheetHeader>
        <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-8 py-6">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold">
              {translate(
                'auto.components.settings.AccountsPane.currentEnvironmentAccounts',
                'Accounts in this environment'
              )}
            </h3>
            {!isCodex && adding ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void window.api.claudeAccounts.cancelPendingLogin()}
              >
                <X className="size-4" />
                {translate('auto.components.settings.AccountsPane.dbb9626ed1', 'Cancel')}
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={add} disabled={addDisabled}>
                {adding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                {translate('auto.components.settings.AccountsPane.b0e948a4f9', 'Add Account')}
              </Button>
            )}
          </div>
          {model.isRemoteAccountScope ? (
            <div className="mt-4">{model.remoteAccountScopeNotice}</div>
          ) : null}
          {isCodex && (model.activeCodexAuthWarning || model.codexConfigSyncWarning) ? (
            <div className="mt-4 flex gap-2 rounded-lg border border-status-warning/40 bg-status-warning/5 p-3 text-xs text-status-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {translate(
                'auto.components.settings.AccountsPane.codexAttentionRequired',
                'Codex needs attention. Refresh the affected sign-in or restore its configuration before starting new sessions.'
              )}
            </div>
          ) : null}
          <div className="mt-4">
            <SystemAccountRow kind={kind} model={model} />
          </div>
          <div className="mt-8 flex items-center gap-2">
            <h3 className="text-base font-semibold">
              {translate('auto.components.settings.AccountsPane.addedAccounts', 'Added accounts')}
            </h3>
            <span className="text-sm text-muted-foreground">
              {loadState === 'loaded' ? accountCount : '—'}
            </span>
          </div>
          <div className="mt-4">
            {isCodex ? (
              <CodexAccountsSheetList model={model} />
            ) : (
              <ClaudeAccountsSheetList model={model} />
            )}
          </div>
          <div className="mt-5 flex gap-2 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {translate(
              'auto.components.settings.AccountsPane.restartAccountNotice',
              'After switching, running sessions for this provider may need to be restarted.'
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
