// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render as renderUi, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type {
  ClaudeManagedAccountSummary,
  ClaudeRateLimitAccountsState
} from '../../../../shared/managed-account-types'
import { i18n } from '../../i18n/i18n'
import { useAppStore } from '../../store'
import { ClaudeAccountsSheetList } from './accounts-pane-claude-section'
import type { AccountsPaneSectionModel } from './accounts-pane-types'

function account(
  id: string,
  email: string,
  overrides: Partial<ClaudeManagedAccountSummary> = {}
): ClaudeManagedAccountSummary {
  return {
    id,
    email,
    managedAuthRuntime: 'host',
    wslDistro: null,
    authMethod: 'subscription-oauth',
    organizationUuid: null,
    organizationName: null,
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1,
    ...overrides
  }
}

function makeModel(
  state: Partial<ClaudeRateLimitAccountsState> = {},
  settings: Partial<GlobalSettings> = {}
): AccountsPaneSectionModel {
  const claudeAccounts: ClaudeRateLimitAccountsState = {
    accounts: [],
    activeAccountId: null,
    ...state
  }
  const accountRuntime = { runtime: 'host' as const, wslDistro: null, label: 'This device' }
  const model: AccountsPaneSectionModel = {
    // Unused by the Claude section; present only so the model is the real type.
    updateSettings: vi.fn(),
    accountOwner: { kind: 'local' },
    accountScopeKey: 'local:host:',
    claudeAccountsLoadState: 'loaded',
    codexAccountsLoadState: 'loaded',
    miniMaxCredentialLoadState: 'loaded',
    refreshMiniMaxCredentialStatus: vi.fn(async () => {}),
    searchQuery: '',
    recordFeatureInteraction: vi.fn(),
    wslSupportedPlatform: false,
    wslAvailable: false,
    wslDistros: [],
    localAccountRuntime: accountRuntime,
    localAccountRuntimeSentenceLabel: 'this device',
    remoteServerName: null,
    codexAccounts: { accounts: [], activeAccountId: null },
    codexAction: 'idle',
    visibleCodexAccounts: [],
    systemCodexActive: true,
    systemCodexNeedsSignIn: false,
    systemCodexMissingSignIn: false,
    systemCodexIdentity: undefined,
    activeCodexAuthWarning: null,
    activeCodexAccountId: null,
    codexConfigSync: null,
    codexConfigSyncWarning: null,
    codexRateLimits: null,
    codexRateLimitTarget: { runtime: 'host', wslDistro: null },
    setRemoveCodexTarget: vi.fn(),
    runCodexAccountAction: vi.fn(async () => {}),
    recordOpenCodeSettingEdit: vi.fn(),
    miniMaxRateLimits: null,
    miniMaxApiKeyDraft: '',
    setMiniMaxApiKeyDraft: vi.fn(),
    miniMaxApiKeyConfigured: false,
    miniMaxApiKeyProtection: null,
    saveMiniMaxApiKey: vi.fn(async () => {}),
    clearMiniMaxApiKey: vi.fn(async () => {}),
    miniMaxCookieDraft: '',
    setMiniMaxCookieDraft: vi.fn(),
    miniMaxConfigured: false,
    miniMaxCookieProtection: null,
    miniMaxCredentialBusy: false,
    saveMiniMaxCookie: vi.fn(async () => {}),
    clearMiniMaxCookie: vi.fn(async () => {}),
    accountRuntime,
    accountRuntimeSentenceLabel: 'this device',
    accountRuntimeUnavailable: false,
    accountVisibilityOptions: { remoteOwner: false, ownerPlatform: 'darwin' },
    claudeAccounts,
    claudeAction: 'idle',
    isRemoteAccountScope: false,
    remoteAccountScopeNotice: null,
    runClaudeAccountAction: vi.fn(async () => {}),
    setRemoveClaudeTarget: vi.fn(),
    settings: { ...getDefaultSettings('/tmp'), ...settings },
    systemClaudeActive: claudeAccounts.activeAccountId === null,
    visibleClaudeAccounts: claudeAccounts.accounts,
    wslCapabilitiesLoading: false
  }
  return model
}

function render(
  state: Partial<ClaudeRateLimitAccountsState> = {},
  settings: Partial<GlobalSettings> = {}
): string {
  return renderToStaticMarkup(
    React.createElement(ClaudeAccountsSheetList, { model: makeModel(state, settings) })
  )
}

afterEach(cleanup)

function selectButtons(markup: string): string[] {
  return [...markup.matchAll(/<button[^>]*>Switch<\/button>/g)].map(([button]) => button)
}

describe('Claude accounts section', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    useAppStore.setState({ settingsSearchQuery: '', runtimeEnvironments: [] })
  })

  it('asks a folder with no login to sign in again, and keeps it unselectable but removable', () => {
    const markup = render({
      accounts: [
        account('legacy', 'old@example.test', { needsSignIn: true }),
        account('ready', 'ok@example.test')
      ]
    })
    expect(markup).toContain('Sign in again to use this account')
    expect(selectButtons(markup).map((button) => button.includes('disabled=""'))).toEqual([
      true,
      false
    ])
    expect(markup.match(/aria-label="Account actions"/g)).toHaveLength(2)
  })

  it("names System default's login and warns only when an older Orca may have copied it there", () => {
    const saved = {
      accounts: [account('a', 'A@example.test')],
      systemDefaultEmail: 'a@example.test'
    }
    const copied = render({ ...saved, systemDefaultMayBeCopied: true })
    expect(copied).toContain('System default: a@example.test')
    expect(copied).toContain('An earlier HiveCode version may have copied that login there.')
    expect(copied).toContain('>Dismiss</button>')
    // Saving your own login as an account too is normal: no copy evidence, no warning.
    expect(render(saved)).not.toContain('An earlier HiveCode version')
    expect(
      render(
        { ...saved, systemDefaultMayBeCopied: true },
        { claudeCopiedSystemDefaultNoticeDismissed: true }
      )
    ).not.toContain('An earlier HiveCode version')
    const own = render({
      ...saved,
      systemDefaultEmail: 'me@example.test',
      systemDefaultMayBeCopied: true
    })
    expect(own).toContain('System default: me@example.test')
    expect(own).not.toContain('An earlier HiveCode version')
  })
})

it('keeps a sign-in-required account removable within the selected owner', () => {
  const model = makeModel({
    accounts: [account('legacy', 'old@example.test', { needsSignIn: true })]
  })
  renderUi(<ClaudeAccountsSheetList model={model} />)
  expect(screen.getByRole('button', { name: 'Switch' }).hasAttribute('disabled')).toBe(true)
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Account actions' }), {
    button: 0,
    ctrlKey: false
  })
  fireEvent.click(screen.getByRole('menuitem', { name: 'Remove Account' }))
  expect(model.setRemoveClaudeTarget).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'legacy', ownerKey: 'local:host:' })
  )
})

it('dismisses the historical local notice without changing credentials', () => {
  const model = makeModel({
    accounts: [account('saved', 'me@example.test')],
    systemDefaultEmail: 'me@example.test',
    systemDefaultMayBeCopied: true
  })
  renderUi(<ClaudeAccountsSheetList model={model} />)
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  expect(model.updateSettings).toHaveBeenCalledWith({
    claudeCopiedSystemDefaultNoticeDismissed: true
  })
  expect(model.runClaudeAccountAction).not.toHaveBeenCalled()
})

it.each(['remote', 'wsl'] as const)(
  'does not apply a local historical dismissal to %s accounts',
  (scope) => {
    const model = makeModel({
      accounts: [account('saved', 'me@example.test')],
      systemDefaultEmail: 'me@example.test',
      systemDefaultMayBeCopied: true
    })
    if (scope === 'remote') {
      model.isRemoteAccountScope = true
      model.accountOwner = { kind: 'environment', environmentId: 'remote-a' }
    } else {
      model.accountRuntime = { runtime: 'wsl', wslDistro: 'Ubuntu', label: 'WSL Ubuntu' }
    }
    renderUi(<ClaudeAccountsSheetList model={model} />)
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()
    expect(model.updateSettings).not.toHaveBeenCalled()
  }
)
