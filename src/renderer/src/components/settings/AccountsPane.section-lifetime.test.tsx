// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type * as I18nModule from '@/i18n/i18n'
import { getDefaultSettings } from '../../../../shared/constants'
import { AccountsPane } from './AccountsPane'

const fake = vi.hoisted(() => ({
  query: '',
  cursorStatus: vi.fn(async () => ({
    signedIn: false,
    email: null,
    displayName: null,
    credentialSource: null,
    planType: null,
    tokenFresh: false,
    error: null
  })),
  cursorRefresh: vi.fn(async () => {}),
  cursorUsage: { updatedAt: 0 },
  status: vi.fn(async () => ({
    signedIn: false,
    email: null,
    teamId: null,
    tokenFresh: false,
    error: null
  })),
  pending: vi.fn(async () => null),
  subscribe: vi.fn(() => vi.fn()),
  refresh: vi.fn(async () => {}),
  write: vi.fn(),
  watcher: vi.fn(() => ({ close: vi.fn() })),
  grokUsage: { updatedAt: 0 }
}))
vi.mock('@/i18n/i18n', async () => ({
  ...(await vi.importActual<typeof I18nModule>('@/i18n/i18n')),
  translate: (_key: string, fallback: string, values?: Record<string, string | number>) =>
    Object.entries(values ?? {}).reduce(
      (text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)),
      fallback
    )
}))
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      settingsSearchQuery: fake.query,
      rateLimits: {
        codex: null,
        codexTarget: { runtime: 'host', wslDistro: null },
        minimax: null,
        cursor: fake.cursorUsage,
        grok: fake.grokUsage
      },
      runtimeEnvironments: [],
      refreshRateLimits: fake.cursorRefresh,
      refreshGrokRateLimits: fake.refresh,
      recordFeatureInteraction: fake.write,
      fetchSettings: fake.write
    })
}))
vi.mock('@/runtime/runtime-provider-accounts-client', () => ({
  emptyClaudeAccountsState: () => ({
    accounts: [],
    activeAccountId: null,
    activeAccountIdsByRuntime: { host: null, wsl: {} }
  }),
  emptyCodexAccountsState: () => ({
    accounts: [],
    activeAccountId: null,
    activeAccountIdsByRuntime: { host: null, wsl: {} }
  }),
  hasRemoteProviderAccountOwner: (settings: { activeRuntimeEnvironmentId?: string }) =>
    Boolean(settings.activeRuntimeEnvironmentId),
  watchProviderAccounts: fake.watcher,
  selectClaudeProviderAccount: fake.write,
  selectCodexProviderAccount: fake.write,
  removeClaudeProviderAccount: fake.write,
  removeCodexProviderAccount: fake.write
}))
beforeEach(() => {
  vi.clearAllMocks()
  fake.query = ''
  fake.grokUsage = { updatedAt: 0 }
  fake.cursorUsage = { updatedAt: 0 }
  Object.assign(window, {
    api: {
      minimaxCredentials: {
        getStatus: vi.fn(async () => ({ cookieConfigured: false, apiKeyConfigured: false }))
      },
      codexConfigSync: {
        status: vi.fn(async () => ({
          state: 'synced',
          reason: null,
          systemConfigPath: '/synthetic/config.toml'
        }))
      },
      codexAccounts: { getPendingLoginUrl: fake.pending, onPendingLoginUrlChanged: fake.subscribe },
      cursorAccounts: { getStatus: fake.cursorStatus },
      grokAccounts: { getStatus: fake.status }
    }
  })
})
afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'api')
})

vi.mock('./accounts-pane-official-service', () => ({
  AccountsOfficialService: () => <div>Hive account</div>
}))

it.each([false, true])(
  'preserves overview nodes and provider reads across search with Windows support %s',
  async (wslSupportedPlatform) => {
    const props = {
      settings: getDefaultSettings('/synthetic'),
      updateSettings: fake.write,
      wslSupportedPlatform
    }
    const view = render(<AccountsPane {...props} />)
    await act(async () => {})
    const grokRow = document.getElementById('accounts-grok')
    const cursorRow = document.getElementById('accounts-cursor')
    const codexHeading = screen.getByRole('heading', { name: 'Codex', level: 4 })
    expect(grokRow).not.toBeNull()
    expect(cursorRow).not.toBeNull()
    const watcherCount = fake.watcher.mock.calls.length
    const grokReads = fake.status.mock.calls.length
    const cursorReads = fake.cursorStatus.mock.calls.length
    expect(watcherCount).toBeGreaterThan(0)
    expect(grokReads).toBeGreaterThan(0)
    expect(cursorReads).toBeGreaterThan(0)
    for (const query of ['g', 'gr', 'grok', '', 'cu', 'cursor', '', 'cod', 'codex']) {
      fake.query = query
      await act(async () => view.rerender(<AccountsPane {...props} />))
      expect(document.getElementById('accounts-grok')).toBe(grokRow)
      expect(document.getElementById('accounts-cursor')).toBe(cursorRow)
      expect(screen.getByRole('heading', { name: 'Codex', level: 4, hidden: true })).toBe(
        codexHeading
      )
    }
    expect(fake.watcher.mock.calls.length).toBe(watcherCount)
    expect(fake.status.mock.calls.length).toBe(grokReads)
    expect(fake.cursorStatus.mock.calls.length).toBe(cursorReads)
    expect(fake.write).not.toHaveBeenCalled()
  }
)

it('preserves explicit Grok refresh and rereads after the pane genuinely reopens', async () => {
  const props = { settings: getDefaultSettings('/synthetic'), updateSettings: fake.write }
  const view = render(<AccountsPane {...props} />)
  await act(async () => {})
  const row = document.getElementById('accounts-grok')!
  fireEvent.click(within(row).getByRole('button', { name: 'Refresh usage' }))
  await act(async () => {})
  expect(fake.refresh).toHaveBeenCalledTimes(1)
  expect(fake.status).toHaveBeenCalledTimes(2)
  fake.query = 'grok'
  await act(async () => view.rerender(<AccountsPane {...props} />))
  expect(fake.status).toHaveBeenCalledTimes(2)
  view.unmount()
  render(<AccountsPane {...props} />)
  await act(async () => {})
  expect(fake.status).toHaveBeenCalledTimes(3)
})

it('keeps usage-driven Grok status refreshes while its overview row stays mounted', async () => {
  const props = { settings: getDefaultSettings('/synthetic'), updateSettings: fake.write }
  const view = render(<AccountsPane {...props} />)
  await act(async () => {})
  fake.grokUsage = { updatedAt: 10 }
  await act(async () => view.rerender(<AccountsPane {...props} />))
  expect(fake.status).toHaveBeenCalledTimes(2)
  fake.query = 'gro'
  await act(async () => view.rerender(<AccountsPane {...props} />))
  expect(fake.status).toHaveBeenCalledTimes(2)
  fake.grokUsage = { updatedAt: 11 }
  await act(async () => view.rerender(<AccountsPane {...props} />))
  expect(fake.status).toHaveBeenCalledTimes(3)
})

it('keeps the owner subscription across search and closes it when the pane unmounts', async () => {
  const props = { settings: getDefaultSettings('/synthetic'), updateSettings: fake.write }
  const view = render(<AccountsPane {...props} />)
  await act(async () => {})
  const watcher = fake.watcher.mock.results[0].value
  fake.query = 'codex'
  await act(async () => view.rerender(<AccountsPane {...props} />))
  fake.query = 'grok'
  await act(async () => view.rerender(<AccountsPane {...props} />))
  expect(watcher.close).not.toHaveBeenCalled()
  expect(fake.watcher).toHaveBeenCalledTimes(1)
  view.unmount()
  expect(watcher.close).toHaveBeenCalledTimes(1)
  render(<AccountsPane {...props} />)
  await act(async () => {})
  expect(fake.watcher).toHaveBeenCalledTimes(2)
})

it('keeps Cursor refresh driven by usage updates and genuine pane reopen', async () => {
  const props = { settings: getDefaultSettings('/synthetic'), updateSettings: fake.write }
  const view = render(<AccountsPane {...props} />)
  await act(async () => {})
  const row = document.getElementById('accounts-cursor')!
  fireEvent.click(within(row).getByRole('button', { name: 'Refresh usage' }))
  await act(async () => {})
  expect(fake.cursorRefresh).toHaveBeenCalledTimes(1)
  expect(fake.cursorStatus).toHaveBeenCalledTimes(1)
  fake.cursorUsage = { updatedAt: 1 }
  await act(async () => view.rerender(<AccountsPane {...props} />))
  expect(fake.cursorStatus).toHaveBeenCalledTimes(2)
  fake.query = 'cursor'
  await act(async () => view.rerender(<AccountsPane {...props} />))
  expect(fake.cursorStatus).toHaveBeenCalledTimes(2)
  view.unmount()
  render(<AccountsPane {...props} />)
  await act(async () => {})
  expect(fake.cursorStatus).toHaveBeenCalledTimes(3)
})
