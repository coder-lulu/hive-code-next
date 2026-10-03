// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { i18n } from '../../i18n/i18n'
import { useAppStore } from '../../store'
import {
  emptyClaudeAccountsState,
  emptyCodexAccountsState,
  type ProviderAccountsSnapshot,
  watchProviderAccounts
} from '@/runtime/runtime-provider-accounts-client'
import type * as ProviderAccountsClient from '@/runtime/runtime-provider-accounts-client'
import { AccountsPane } from './AccountsPane'

vi.mock('@/runtime/runtime-provider-accounts-client', async (importOriginal) => {
  const original = await importOriginal<typeof ProviderAccountsClient>()
  return { ...original, watchProviderAccounts: vi.fn() }
})
vi.mock('./accounts-pane-config-sync', () => ({ watchCodexConfigSyncStatus: () => () => {} }))
vi.mock('./accounts-pane-removal-dialogs', () => ({ renderAccountsRemovalDialogs: () => null }))
vi.mock('./accounts-pane-overview', async () => {
  const { createElement } = await import('react')
  return {
    AccountsPaneOverview: ({
      model
    }: {
      model: {
        codexAccountsLoadState: string
        claudeAccountsLoadState: string
        visibleCodexAccounts: { id: string }[]
        systemCodexIdentity?: { email: string | null }
      }
    }) =>
      createElement(
        'div',
        null,
        createElement('span', { 'data-testid': 'codex-state' }, model.codexAccountsLoadState),
        createElement('span', { 'data-testid': 'claude-state' }, model.claudeAccountsLoadState),
        createElement(
          'span',
          { 'data-testid': 'codex-ids' },
          model.visibleCodexAccounts.map((account) => account.id).join(',')
        ),
        createElement(
          'span',
          { 'data-testid': 'system-email' },
          model.systemCodexIdentity?.email ?? ''
        )
      )
  }
})

type WatchHandlers = Parameters<typeof watchProviderAccounts>[1]

function codexSnapshot(id: string): ProviderAccountsSnapshot {
  return {
    claude: emptyClaudeAccountsState(),
    codex: {
      ...emptyCodexAccountsState(),
      accounts: [
        { id, email: `${id}@example.com`, createdAt: 1, updatedAt: 1, lastAuthenticatedAt: 1 }
      ],
      systemDefault: {
        hasAuth: true,
        authKind: 'oauth',
        email: `${id}@example.com`,
        providerAccountId: null,
        workspaceLabel: null
      }
    },
    rateLimits: null
  }
}

describe('AccountsPane owner transitions', () => {
  let handlers: WatchHandlers[]
  let previousApiDescriptor: PropertyDescriptor | undefined

  beforeEach(async () => {
    await i18n.changeLanguage('en')
    handlers = []
    vi.mocked(watchProviderAccounts).mockImplementation((_settings, callbacks) => {
      handlers.push(callbacks)
      return { close: vi.fn() }
    })
    previousApiDescriptor = Object.getOwnPropertyDescriptor(window, 'api')
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        minimaxCredentials: {
          getStatus: vi.fn(async () => ({ cookieConfigured: false, apiKeyConfigured: false }))
        }
      }
    })
    useAppStore.setState({ settingsSearchQuery: '', runtimeEnvironments: [] })
  })

  afterEach(() => {
    cleanup()
    if (previousApiDescriptor) {
      Object.defineProperty(window, 'api', previousApiDescriptor)
    } else {
      Reflect.deleteProperty(window, 'api')
    }
  })

  it('keeps the healthy provider loaded after the other local provider fails', () => {
    const settings = getDefaultSettings('/tmp')
    render(<AccountsPane settings={settings} updateSettings={vi.fn()} />)

    act(() => {
      handlers[0]?.onSnapshot({ ...codexSnapshot('healthy'), failedProviders: ['claude'] })
      handlers[0]?.onError(new Error('Claude keychain unavailable'), 'claude')
    })

    expect(screen.getByTestId('codex-state').textContent).toBe('loaded')
    expect(screen.getByTestId('claude-state').textContent).toBe('error')
    expect(screen.getByTestId('codex-ids').textContent).toBe('healthy')
  })

  it('does not expose a prior owner when a remote environment named local fails', () => {
    const local = getDefaultSettings('/tmp')
    const { rerender } = render(<AccountsPane settings={local} updateSettings={vi.fn()} />)
    act(() => handlers[0]?.onSnapshot(codexSnapshot('desktop')))
    expect(screen.getByTestId('system-email').textContent).toBe('desktop@example.com')

    const remote: GlobalSettings = { ...local, activeRuntimeEnvironmentId: 'local' }
    rerender(<AccountsPane settings={remote} updateSettings={vi.fn()} />)
    expect(screen.getByTestId('codex-state').textContent).toBe('loading')
    expect(screen.getByTestId('codex-ids').textContent).toBe('')
    expect(screen.getByTestId('system-email').textContent).toBe('')

    act(() => handlers[1]?.onError(new Error('Remote unavailable')))
    expect(screen.getByTestId('codex-state').textContent).toBe('error')
    expect(screen.getByTestId('codex-ids').textContent).toBe('')
    expect(screen.getByTestId('system-email').textContent).toBe('')
  })
})
