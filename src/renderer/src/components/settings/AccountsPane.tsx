import { useAccountsPaneOwner } from './use-accounts-pane-owner'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '../../store'
import { translate } from '@/i18n/i18n'
import {
  emptyClaudeAccountsState,
  emptyCodexAccountsState,
  watchProviderAccounts
} from '@/runtime/runtime-provider-accounts-client'
import { getCodexAccountAuthWarning } from './codex-account-auth-warning'
import { getCodexConfigSyncWarning } from './codex-config-sync-warning'
import {
  getProviderAccountActiveIdForView,
  providerAccountIsActiveInView,
  providerAccountMatchesView
} from './provider-account-visibility'
import type {
  AccountsPaneProps,
  ProviderRosterLoadState as LoadState,
  AccountsPaneSectionModel,
  ClaudeAccountAction,
  CodexAccountAction,
  RemoveAccountTarget
} from './accounts-pane-types'
import {
  EMPTY_WSL_DISTROS,
  getSelectedAccountRuntime,
  getRemoteAccountRuntimeLabel,
  getAccountRuntimeSentenceLabel
} from './accounts-pane-runtime'
import { useCodexConfigSyncStatus } from './use-codex-config-sync-status'
import {
  createClaudeAccountActionRunner,
  createCodexAccountActionRunner
} from './accounts-pane-account-actions'
import { useUsageHostSettings } from './use-usage-host-settings'
import { ZcodePlanAccountsSection } from './ZcodePlanAccountsSection'
import { renderAccountsRemovalDialogs } from './accounts-pane-removal-dialogs'
import { renderAccountsRemoteScopeNotice } from './accounts-pane-remote-scope-notice'
import { AccountsPaneOverview } from './accounts-pane-overview'
import { useAccountsPaneNavigation } from './use-accounts-pane-navigation'
import './accounts-pane.css'

export function AccountsPane({
  settings,
  updateSettings,
  hostScope,
  wslSupportedPlatform = false,
  wslAvailable = false,
  wslDistros = EMPTY_WSL_DISTROS,
  wslCapabilitiesLoading = false,
  accountOwnerPlatform = null,
  navigationTargetSectionId = null,
  wslHostDistro = null
}: AccountsPaneProps): React.JSX.Element {
  const searchQuery = useAppStore((s) => s.settingsSearchQuery)
  const codexRateLimits = useAppStore((s) => s.rateLimits.codex)
  const codexRateLimitTarget = useAppStore((s) => s.rateLimits.codexTarget)
  const miniMaxRateLimits = useAppStore((s) => s.rateLimits.minimax)
  const recordFeatureInteraction = useAppStore((s) => s.recordFeatureInteraction)
  const fetchSettings = useAppStore((s) => s.fetchSettings)
  const runtimeEnvironments = useAppStore((s) => s.runtimeEnvironments)
  const recordedOpenCodeSettingEditsRef = useRef(new Set<'cookie' | 'workspaceId' | 'apiKey'>())
  const [accountsReloadKey, setAccountsReloadKey] = useState(0)
  const localAccountRuntime = getSelectedAccountRuntime(
    settings,
    wslSupportedPlatform,
    wslAvailable,
    wslDistros,
    wslCapabilitiesLoading,
    wslHostDistro
  )
  // The Settings Host is the account authority, independent of the default project host.
  const accountOwner = hostScope.target
  const isRemoteAccountScope = accountOwner.kind === 'environment'
  const activeRuntimeEnvironmentId =
    accountOwner.kind === 'environment' ? accountOwner.environmentId : null
  // Why: keep the real name separate from the prose fallback below; the scope
  // label must not interpolate the fallback.
  const remoteServerName = isRemoteAccountScope
    ? (runtimeEnvironments.find((environment) => environment.id === activeRuntimeEnvironmentId)
        ?.name ?? null)
    : null
  const usageHostSettings = useUsageHostSettings(
    accountOwner,
    remoteServerName,
    settings,
    updateSettings
  )
  const remoteServerLabel = isRemoteAccountScope
    ? getRemoteAccountRuntimeLabel(remoteServerName)
    : null
  const accountRuntime = isRemoteAccountScope
    ? { runtime: 'host' as const, label: remoteServerLabel ?? '' }
    : localAccountRuntime
  const { providerAccountOwnerKey, isCurrentAccountOwner } = useAccountsPaneOwner(accountOwner)
  const accountScopeKey = `${providerAccountOwnerKey}:${accountRuntime.runtime}:${accountRuntime.wslDistro ?? ''}`
  const currentAccountScopeKeyRef = useRef(accountScopeKey)
  currentAccountScopeKeyRef.current = accountScopeKey
  const { accountSheet, credentialSheet, setAccountSheet, setCredentialSheet } =
    useAccountsPaneNavigation({
      accountScopeKey,
      navigationTargetSectionId,
      searchQuery
    })
  // Why: host runtime labels are standalone UI labels; interpolated prose needs sentence casing.
  const localAccountRuntimeSentenceLabel = getAccountRuntimeSentenceLabel(localAccountRuntime)
  const accountRuntimeSentenceLabel = isRemoteAccountScope
    ? accountRuntime.label
    : localAccountRuntimeSentenceLabel
  const [codexAccounts, setCodexAccounts] = useState(emptyCodexAccountsState)
  const [codexDataOwnerKey, setCodexDataOwnerKey] = useState<string | null>(null)
  const [codexAccountsLoadState, setCodexAccountsLoadState] = useState<LoadState>('loading')
  const [accountsSnapshotOwnerKey, setAccountsSnapshotOwnerKey] = useState<string | null>(null)
  const displayedCodexAccountsLoadState =
    accountsSnapshotOwnerKey === providerAccountOwnerKey ? codexAccountsLoadState : 'loading'
  const codexAccountsLoaded = displayedCodexAccountsLoadState === 'loaded'
  const [codexAction, setCodexAction] = useState<CodexAccountAction>('idle')
  const [claudeAccounts, setClaudeAccounts] = useState(emptyClaudeAccountsState)
  const [claudeDataOwnerKey, setClaudeDataOwnerKey] = useState<string | null>(null)
  const [claudeAccountsLoadState, setClaudeAccountsLoadState] = useState<LoadState>('loading')
  const displayedClaudeAccountsLoadState =
    accountsSnapshotOwnerKey === providerAccountOwnerKey ? claudeAccountsLoadState : 'loading'
  const [claudeAction, setClaudeAction] = useState<ClaudeAccountAction>('idle')
  // Why: capture the account's runtime slot when the dialog opens; the roster
  // can change underneath an open dialog and lose the slot to diff for restarts.
  const [removeCodexTarget, setRemoveCodexTarget] = useState<RemoveAccountTarget | null>(null)
  const [removeClaudeTarget, setRemoveClaudeTarget] = useState<RemoveAccountTarget | null>(null)
  const scopedCodexAccounts =
    codexDataOwnerKey === providerAccountOwnerKey ? codexAccounts : emptyCodexAccountsState()
  const scopedClaudeAccounts =
    claudeDataOwnerKey === providerAccountOwnerKey ? claudeAccounts : emptyClaudeAccountsState()
  useEffect(() => {
    setCodexAction('idle')
    setClaudeAction('idle')
    setRemoveCodexTarget(null)
    setRemoveClaudeTarget(null)
  }, [accountScopeKey])
  const accountVisibilityOptions = {
    remoteOwner: isRemoteAccountScope,
    ownerPlatform: accountOwnerPlatform
  }
  const visibleClaudeAccounts = scopedClaudeAccounts.accounts.filter((account) =>
    providerAccountMatchesView(account, accountRuntime, accountVisibilityOptions)
  )
  const visibleCodexAccounts = scopedCodexAccounts.accounts.filter((account) =>
    providerAccountMatchesView(account, accountRuntime, accountVisibilityOptions)
  )
  const activeCodexAccountId = getProviderAccountActiveIdForView(
    scopedCodexAccounts,
    accountRuntime
  )
  // Why: System default lights only when no account row is active; while a remote
  // owner's platform is unknown WSL rows hide fail-closed, so check the full roster.
  const ownerPlatformUnknown = isRemoteAccountScope && accountOwnerPlatform === null
  const systemCodexActive = !(
    ownerPlatformUnknown ? scopedCodexAccounts.accounts : visibleCodexAccounts
  ).some((account) =>
    providerAccountIsActiveInView(
      account,
      scopedCodexAccounts,
      accountRuntime,
      accountVisibilityOptions
    )
  )
  const systemClaudeActive = !(
    ownerPlatformUnknown ? scopedClaudeAccounts.accounts : visibleClaudeAccounts
  ).some((account) =>
    providerAccountIsActiveInView(
      account,
      scopedClaudeAccounts,
      accountRuntime,
      accountVisibilityOptions
    )
  )
  // Why: the system default's real identity is host-scoped (it reflects the
  // runtime's own ~/.codex), so only surface it in the host view. Per-distro
  // WSL falls back to the generic label.
  const systemCodexIdentity =
    accountRuntime.runtime === 'host' ? scopedCodexAccounts.systemDefault : undefined
  // Why: remote snapshots own their system-default identity, but the desktop's
  // rate-limit poll must not be misattributed to a remote account owner.
  const activeCodexAuthWarning = codexAccountsLoaded
    ? getCodexAccountAuthWarning({
        limits: isRemoteAccountScope ? null : codexRateLimits,
        target: codexRateLimitTarget,
        runtime: accountRuntime,
        activeAccountId: activeCodexAccountId,
        accountId: activeCodexAccountId,
        authKind: activeCodexAccountId === null ? systemCodexIdentity?.authKind : undefined
      })
    : null
  // Why: the mirror keeps serving the last synced settings when ~/.codex is
  // unusable, so without this the user only sees their edits being ignored.
  const codexConfigSync = useCodexConfigSyncStatus(
    isRemoteAccountScope,
    accountRuntime.runtime,
    activeCodexAccountId,
    codexAccountsLoaded
  )
  const codexConfigSyncWarning = getCodexConfigSyncWarning(codexConfigSync)
  const accountRuntimeUnavailable =
    !hostScope.available ||
    (accountRuntime.runtime === 'wsl' && !wslAvailable && !wslCapabilitiesLoading)

  const recordOpenCodeSettingEdit = (field: 'cookie' | 'workspaceId' | 'apiKey'): void => {
    if (recordedOpenCodeSettingEditsRef.current.has(field)) {
      return
    }
    recordedOpenCodeSettingEditsRef.current.add(field)
    recordFeatureInteraction('usage-tracking')
  }
  useEffect(() => {
    // Why: remote snapshots stream usage refreshes after the synchronous ready
    // message, so the watcher stays open for the pane's lifetime; the local
    // path resolves once and the close() is a no-op.
    let active = true
    let snapshotReceived = false
    const watcher = watchProviderAccounts(accountOwner, {
      onSnapshot: (snapshot) => {
        if (!active) {
          return
        }
        snapshotReceived = true
        setAccountsSnapshotOwnerKey(providerAccountOwnerKey)
        // Why: a failed provider's half is a substituted empty roster, not
        // authoritative data; keep prior state and leave the loaded gate shut.
        if (!snapshot.failedProviders?.includes('codex')) {
          setCodexAccounts(snapshot.codex)
          setCodexDataOwnerKey(providerAccountOwnerKey)
          setCodexAccountsLoadState('loaded')
        } else {
          setCodexAccountsLoadState('error')
        }
        if (!snapshot.failedProviders?.includes('claude')) {
          setClaudeAccounts(snapshot.claude)
          setClaudeDataOwnerKey(providerAccountOwnerKey)
          setClaudeAccountsLoadState('loaded')
        } else {
          setClaudeAccountsLoadState('error')
        }
      },
      onError: (error) => {
        if (!active) {
          return
        }
        setAccountsSnapshotOwnerKey(providerAccountOwnerKey)
        // Local partial failures are already scoped by snapshot.failedProviders.
        if (!snapshotReceived || isRemoteAccountScope) {
          setCodexAccountsLoadState('error')
          setClaudeAccountsLoadState('error')
        }
        toast.error(
          translate(
            'auto.components.settings.AccountsPane.loadAccountsFailed',
            'Could not load provider accounts.'
          ),
          { description: String((error as Error)?.message ?? error) }
        )
      }
    })
    return () => {
      active = false
      watcher.close()
    }
  }, [
    accountOwner,
    activeRuntimeEnvironmentId,
    accountsReloadKey,
    providerAccountOwnerKey,
    isRemoteAccountScope
  ])

  const runCodexAccountAction = createCodexAccountActionRunner({
    settings,
    accountOwner,
    isCurrentAccountOwner: () =>
      isCurrentAccountOwner() && currentAccountScopeKeyRef.current === accountScopeKey,
    accountRuntime,
    isRemoteAccountScope,
    codexAccounts: scopedCodexAccounts,
    setCodexAccounts: (next) => {
      setCodexAccounts(next)
      setCodexDataOwnerKey(providerAccountOwnerKey)
    },
    setCodexAccountsLoaded: (loaded) =>
      setCodexAccountsLoadState(
        typeof loaded === 'function'
          ? loaded(codexAccountsLoaded)
            ? 'loaded'
            : 'loading'
          : loaded
            ? 'loaded'
            : 'loading'
      ),
    setCodexAction,
    fetchSettings,
    recordFeatureInteraction
  })
  const runClaudeAccountAction = createClaudeAccountActionRunner({
    accountOwner,
    isCurrentAccountOwner: () =>
      isCurrentAccountOwner() && currentAccountScopeKeyRef.current === accountScopeKey,
    accountRuntime,
    isRemoteAccountScope,
    claudeAccounts: scopedClaudeAccounts,
    setClaudeAccounts: (next) => {
      setClaudeAccounts(next)
      setClaudeDataOwnerKey(providerAccountOwnerKey)
    },
    setClaudeAction,
    fetchSettings,
    recordFeatureInteraction
  })
  const model: AccountsPaneSectionModel = {
    settings,
    accountScopeKey,
    accountOwner,
    updateSettings,
    searchQuery,
    recordFeatureInteraction,
    wslSupportedPlatform,
    wslAvailable,
    wslDistros,
    wslCapabilitiesLoading,
    localAccountRuntime,
    localAccountRuntimeSentenceLabel,
    isRemoteAccountScope,
    remoteServerName,
    remoteAccountScopeNotice: renderAccountsRemoteScopeNotice(
      isRemoteAccountScope,
      remoteServerName
    ),
    accountRuntime,
    accountRuntimeSentenceLabel,
    accountRuntimeUnavailable,
    accountVisibilityOptions,
    claudeAccounts: scopedClaudeAccounts,
    claudeAccountsLoadState: displayedClaudeAccountsLoadState,
    claudeAction,
    visibleClaudeAccounts,
    systemClaudeActive,
    setRemoveClaudeTarget,
    runClaudeAccountAction,
    codexAccounts: scopedCodexAccounts,
    codexAccountsLoadState: displayedCodexAccountsLoadState,
    codexAction,
    visibleCodexAccounts,
    systemCodexActive,
    systemCodexNeedsSignIn: activeCodexAccountId === null && Boolean(activeCodexAuthWarning),
    systemCodexMissingSignIn: activeCodexAuthWarning === 'missing-sign-in',
    systemCodexIdentity,
    activeCodexAuthWarning,
    activeCodexAccountId,
    codexConfigSync,
    codexConfigSyncWarning,
    codexRateLimits,
    codexRateLimitTarget,
    setRemoveCodexTarget,
    runCodexAccountAction,
    recordOpenCodeSettingEdit,
    miniMaxRateLimits: isRemoteAccountScope ? null : miniMaxRateLimits,
    usageHostSettings
  }
  return (
    <div className="accounts-pane">
      {renderAccountsRemovalDialogs(model, removeCodexTarget, removeClaudeTarget)}
      <AccountsPaneOverview
        model={model}
        accountSheet={accountSheet}
        credentialSheet={credentialSheet}
        onAccountSheetChange={setAccountSheet}
        onCredentialSheetChange={setCredentialSheet}
        onRetryAccounts={() => {
          setCodexAccountsLoadState('loading')
          setClaudeAccountsLoadState('loading')
          setAccountsReloadKey((key) => key + 1)
        }}
      />
      <ZcodePlanAccountsSection
        key={`${accountScopeKey}:zcode`}
        host={{ owner: accountOwner, label: remoteServerName }}
        usageSettings={usageHostSettings}
      />
    </div>
  )
}
