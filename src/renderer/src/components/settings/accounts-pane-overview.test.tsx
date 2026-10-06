// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import type { AccountsPaneSectionModel } from './accounts-pane-types'

vi.mock('./accounts-pane-official-service', () => ({
  AccountsOfficialService: () => <section>Official service</section>
}))
vi.mock('./GrokAccountsSection', () => ({
  GrokAccountsSection: () => <div>Grok</div>
}))
vi.mock('./CursorAccountsSection', () => ({
  CursorAccountsSection: () => <div>Cursor usage</div>
}))
vi.mock('@/i18n/i18n', () => ({
  i18n: { language: 'en', getResourceBundle: () => undefined },
  getIntlLocale: () => 'en-US',
  translate: (_key: string, fallback: string, values?: Record<string, string | number>) =>
    Object.entries(values ?? {}).reduce(
      (copy, [key, value]) => copy.replace(`{{${key}}}`, String(value)),
      fallback
    )
}))

import { AccountsPaneOverview } from './accounts-pane-overview'

function createModel(): AccountsPaneSectionModel {
  const settings = getDefaultSettings('/tmp')
  const claudeAccount = {
    id: 'claude-1',
    email: 'claude@example.com',
    authMethod: 'subscription-oauth' as const,
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1
  }
  return {
    settings,
    accountScopeKey: 'local:host:',
    updateSettings: vi.fn(),
    searchQuery: '',
    recordFeatureInteraction: vi.fn(),
    wslSupportedPlatform: false,
    wslAvailable: false,
    wslDistros: [],
    wslCapabilitiesLoading: false,
    localAccountRuntime: { runtime: 'host', label: 'This device' },
    localAccountRuntimeSentenceLabel: 'this device',
    isRemoteAccountScope: false,
    remoteServerName: null,
    remoteAccountScopeNotice: null,
    accountRuntime: { runtime: 'host', label: 'This device' },
    accountRuntimeSentenceLabel: 'this device',
    accountRuntimeUnavailable: false,
    accountVisibilityOptions: { remoteOwner: false, ownerPlatform: null },
    claudeAccounts: { accounts: [claudeAccount], activeAccountId: null },
    claudeAccountsLoadState: 'loaded',
    claudeAction: 'idle',
    visibleClaudeAccounts: [claudeAccount],
    systemClaudeActive: true,
    setRemoveClaudeTarget: vi.fn(),
    runClaudeAccountAction: vi.fn(),
    codexAccounts: { accounts: [], activeAccountId: null },
    codexAccountsLoadState: 'loaded',
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
    runCodexAccountAction: vi.fn(),
    recordOpenCodeSettingEdit: vi.fn(),
    miniMaxRateLimits: null,
    miniMaxApiKeyDraft: '',
    setMiniMaxApiKeyDraft: vi.fn(),
    miniMaxApiKeyConfigured: false,
    saveMiniMaxApiKey: vi.fn(),
    clearMiniMaxApiKey: vi.fn(),
    miniMaxCookieDraft: '',
    miniMaxApiKeyProtection: null,
    miniMaxCookieProtection: null,
    setMiniMaxCookieDraft: vi.fn(),
    miniMaxConfigured: false,
    miniMaxCredentialBusy: false,
    miniMaxCredentialLoadState: 'loaded',
    refreshMiniMaxCredentialStatus: vi.fn(),
    saveMiniMaxCookie: vi.fn(),
    clearMiniMaxCookie: vi.fn()
  }
}

describe('AccountsPaneOverview', () => {
  let previousApiDescriptor: PropertyDescriptor | undefined

  beforeEach(() => {
    previousApiDescriptor = Object.getOwnPropertyDescriptor(window, 'api')
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        ...window.api,
        opencodeGoCredentials: {
          ...window.api?.opencodeGoCredentials,
          getStatus: vi.fn(async () => ({ apiKeyConfigured: false }))
        }
      }
    })
  })

  afterEach(() => {
    try {
      cleanup()
    } finally {
      if (previousApiDescriptor) {
        Object.defineProperty(window, 'api', previousApiDescriptor)
      } else {
        Reflect.deleteProperty(window, 'api')
      }
    }
  })

  it('opens the provider drawer with the system default and only counts added accounts', () => {
    const model = createModel()
    function TestHost(): React.JSX.Element {
      const [sheet, setSheet] = React.useState<'claude' | 'codex' | null>(null)
      return (
        <AccountsPaneOverview
          model={model}
          accountSheet={sheet}
          credentialSheet={null}
          onAccountSheetChange={setSheet}
          onCredentialSheetChange={vi.fn()}
          onRetryAccounts={vi.fn()}
        />
      )
    }
    render(<TestHost />)

    expect(screen.getByText('Cursor usage')).toBeInTheDocument()
    expect(screen.getByText('Added accounts 1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Manage accounts' }))

    const drawer = screen.getByRole('dialog')
    expect(within(drawer).getByText('Claude accounts')).toBeInTheDocument()
    expect(within(drawer).getByText('System default')).toBeInTheDocument()
    expect(within(drawer).getByText('claude@example.com')).toBeInTheDocument()
    expect(within(drawer).getByText('Added accounts')).toBeInTheDocument()
    expect(within(drawer).getByText('1')).toBeInTheDocument()
    expect(within(drawer).getAllByRole('button', { name: 'Account actions' })).toHaveLength(1)
  })

  it('opens the Claude drawer when starting an empty account login so cancellation stays available', () => {
    const model = createModel()
    model.claudeAccounts = { accounts: [], activeAccountId: null }
    model.visibleClaudeAccounts = []
    function TestHost(): React.JSX.Element {
      const [sheet, setSheet] = React.useState<'claude' | 'codex' | null>(null)
      return (
        <AccountsPaneOverview
          model={model}
          accountSheet={sheet}
          credentialSheet={null}
          onAccountSheetChange={setSheet}
          onCredentialSheetChange={vi.fn()}
          onRetryAccounts={vi.fn()}
        />
      )
    }
    render(<TestHost />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Add Account' })[0]!)

    expect(within(screen.getByRole('dialog')).getByText('Claude accounts')).toBeInTheDocument()
    expect(model.runClaudeAccountAction).toHaveBeenCalledWith('adding', expect.any(Function))
  })

  it('shows the full OpenCode console cookie guidance inside its credential drawer', () => {
    const model = createModel()
    function TestHost(): React.JSX.Element {
      const [sheet, setSheet] = React.useState<'opencode' | 'minimax' | null>(null)
      return (
        <AccountsPaneOverview
          model={model}
          accountSheet={null}
          credentialSheet={sheet}
          onAccountSheetChange={vi.fn()}
          onCredentialSheetChange={setSheet}
          onRetryAccounts={vi.fn()}
        />
      )
    }
    render(<TestHost />)

    const row = document.getElementById('accounts-opencode-go')
    expect(row).not.toBeNull()
    fireEvent.click(within(row!).getByRole('button', { name: 'Configure' }))

    const drawer = screen.getByRole('dialog')
    expect(
      within(drawer).getByPlaceholderText('auth=…; __Host-console_session=…')
    ).toBeInTheDocument()
    expect(drawer).toHaveTextContent(/auth cookie still covers workspace discovery/i)
    expect(drawer).not.toHaveTextContent('Fe26.2**… token or auth=Fe26.2**… header')
  })
})
