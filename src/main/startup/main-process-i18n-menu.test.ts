import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  state: { store: null as { getSettings(): { uiLanguage: 'ja' } } | null },
  language: vi.fn(async (_language: string): Promise<void> => undefined),
  register: vi.fn(),
  milestone: vi.fn()
}))
vi.mock('electron', () => ({ app: { name: 'HiveCode' }, BrowserWindow: class {} }))
vi.mock('../i18n/main-i18n', () => ({ setMainUiLanguage: h.language }))
vi.mock('./main-process-state', () => ({ mainProcessState: h.state }))
vi.mock('../menu/register-app-menu', () => ({
  registerAppMenu: h.register,
  rebuildAppMenu: vi.fn(),
  getNextDefaultOnAppearanceSettingValue: (value: boolean | undefined) => value === false
}))
vi.mock('../window/dashboard-popout-window', () => ({ zoomDashboardPopoutIfFocused: vi.fn() }))
vi.mock('../crash-reporting/crash-breadcrumb-store', () => ({ recordCrashBreadcrumb: vi.fn() }))
vi.mock('./startup-diagnostics', () => ({ logStartupMilestone: h.milestone }))
vi.mock('./main-window-actions', () => ({
  openSettingsFromSystemMenu: vi.fn(),
  quitFromUserCommand: vi.fn(),
  runUserInitiatedUpdateCheck: vi.fn(),
  sendOpenCrashReport: vi.fn(),
  sendOpenFeatureTour: vi.fn(),
  sendOpenSetupGuide: vi.fn()
}))

import { initializeMainProcessI18nAndMenu } from './main-process-i18n-menu'

beforeEach(() => {
  vi.clearAllMocks()
  h.state.store = null
  h.language.mockImplementation(async () => undefined)
})

describe('main menu current i18n initialization', () => {
  it('requires the actual settings store before initializing the menu', async () => {
    await expect(initializeMainProcessI18nAndMenu()).rejects.toThrow('Store must be initialized')
    expect(h.language).not.toHaveBeenCalled()
    expect(h.register).not.toHaveBeenCalled()
  })

  it('awaits the selected language before registering the menu', async () => {
    let release = () => {}
    const ready = new Promise<void>((resolve) => {
      release = resolve
    })
    h.language.mockImplementation(() => ready)
    h.state.store = { getSettings: () => ({ uiLanguage: 'ja' }) }
    const initialization = initializeMainProcessI18nAndMenu()
    expect(h.language).toHaveBeenCalledWith('ja')
    expect(h.register).not.toHaveBeenCalled()
    release()
    await initialization
    expect(h.milestone).toHaveBeenCalledWith('i18n-ready')
    expect(h.register).toHaveBeenCalledWith(expect.objectContaining({ appMenuLabel: 'HiveCode' }))
  })

  it('does not publish a ready menu when language initialization fails', async () => {
    h.state.store = { getSettings: () => ({ uiLanguage: 'ja' }) }
    h.language.mockRejectedValueOnce(new Error('catalog unavailable'))
    await expect(initializeMainProcessI18nAndMenu()).rejects.toThrow('catalog unavailable')
    expect(h.milestone).not.toHaveBeenCalled()
    expect(h.register).not.toHaveBeenCalled()
  })
})
