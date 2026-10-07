import * as fs from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGlobalSettingsFixture } from '../../shared/global-settings-test-fixture'
import type { GlobalSettings } from '../../shared/global-settings-types'
import type { Store } from '../persistence'
import { createMainProcessTaskCodexAccountPorts } from './main-process-task-codex-accounts'

const mocks = vi.hoisted(() => {
  const runtimeHome = {
    prepareForCodexLaunch: vi.fn(),
    prepareForRateLimitFetch: vi.fn(),
    resolveHostCodexHomePathForLaunchReadOnly: vi.fn(),
    getHostCodexHomePathsForSessionDiscovery: vi.fn()
  }
  const state: { codexRuntimeHome: typeof runtimeHome | null } = { codexRuntimeHome: runtimeHome }
  const paths = { userData: '', systemHome: '' }
  return {
    state,
    runtimeHome,
    paths,
    getPath: vi.fn((name: string) => {
      if (name !== 'userData') {
        throw new Error('Unexpected main path request')
      }
      return paths.userData
    }),
    getSystemHome: vi.fn(() => paths.systemHome)
  }
})

vi.mock('electron', () => ({ app: { getPath: mocks.getPath } }))
vi.mock('./main-process-state', () => ({ mainProcessState: mocks.state }))
vi.mock('../codex/codex-home-paths', () => ({ getSystemCodexHomePath: mocks.getSystemHome }))
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof fs>()
  return { ...original, readFileSync: vi.fn(original.readFileSync) }
})

const UNAVAILABLE = /^TASK_MODEL_AUTH_SCOPE_UNAVAILABLE$/
const LOGS = 'logs/paperclip-development/p3/controlled-runtime/account-port-writer'
let directory: string

beforeEach(() => {
  vi.clearAllMocks()
  const temporary = resolve(LOGS, 'tmp')
  fs.mkdirSync(temporary, { recursive: true })
  directory = fs.mkdtempSync(join(temporary, 'ports-'))
  mocks.state.codexRuntimeHome = mocks.runtimeHome
  mocks.paths.userData = join(directory, 'application-data')
  mocks.paths.systemHome = join(directory, 'system-home', '.codex')
  mocks.getPath.mockImplementation((name) => {
    if (name !== 'userData') {
      throw new Error('Unexpected main path request')
    }
    return mocks.paths.userData
  })
  mocks.getSystemHome.mockImplementation(() => mocks.paths.systemHome)
})
afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(directory, { recursive: true, force: true })
})

function fixture() {
  const home = join(mocks.paths.userData, 'codex-accounts', 'managed-row-one', 'home')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(mocks.paths.systemHome, { recursive: true })
  const marker = join(home, '.orca-managed-home')
  fs.writeFileSync(marker, 'managed-row-one\n')
  const settings = createGlobalSettingsFixture({
    codexManagedAccounts: [
      {
        id: 'managed-row-one',
        email: 'synthetic@example.invalid',
        managedHomePath: home,
        managedHomeRuntime: 'host',
        providerAccountId: 'provider_one',
        createdAt: 1,
        updatedAt: 1,
        lastAuthenticatedAt: 1
      }
    ],
    activeCodexManagedAccountId: 'managed-row-one',
    activeCodexManagedAccountIdsByRuntime: { host: 'managed-row-one', wsl: {} }
  })
  const listeners = new Set<Parameters<Store['onSettingsChanged']>[0]>()
  const unsubscribers: (() => void)[] = []
  const getSettings = vi.fn(() => settings)
  const onSettingsChanged = vi.fn((listener: Parameters<Store['onSettingsChanged']>[0]) => {
    listeners.add(listener)
    const unsubscribe = vi.fn(() => {
      listeners.delete(listener)
    })
    unsubscribers.push(unsubscribe)
    return unsubscribe
  })
  const store = {
    getSettings,
    onSettingsChanged,
    updateSettings: vi.fn(),
    getAccountsSnapshot: vi.fn(),
    listAccounts: vi.fn()
  }
  const notify = (updates: Partial<GlobalSettings>) => {
    for (const listener of listeners) {
      listener(updates, settings)
    }
  }
  return { home, marker, settings, listeners, unsubscribers, store, notify }
}

describe('main Task Codex account ports', () => {
  it('assembles lazy ports without reading settings, preparing homes or subscribing', () => {
    const original = fixture()
    const ports = createMainProcessTaskCodexAccountPorts(original.store)
    expect(Object.isFrozen(ports)).toBe(true)
    expect(original.store.getSettings).not.toHaveBeenCalled()
    expect(original.store.onSettingsChanged).not.toHaveBeenCalled()
    expect(mocks.getPath).not.toHaveBeenCalled()
    expect(mocks.getSystemHome).not.toHaveBeenCalled()
    for (const method of Object.values(mocks.runtimeHome)) {
      expect(method).not.toHaveBeenCalled()
    }
  })
  it('resolves selected and pinned snapshots through the original userData root without writes or auth reads', () => {
    const original = fixture()
    const ports = createMainProcessTaskCodexAccountPorts(original.store)
    const before = structuredClone(original.settings)
    const entries = fs.readdirSync(original.home)
    const reads = vi.mocked(fs.readFileSync)
    reads.mockClear()
    const selected = ports.resolveSelected()
    const pinned = ports.resolvePinned(original.home)
    for (const scope of [selected, pinned]) {
      expect(scope.accountId).toBe('managed-row-one')
      expect(scope.codexHome).toBe(original.home)
      expect(scope.providerAccountId).toBe('provider_one')
      expect(Object.isFrozen(scope)).toBe(true)
      expect(scope.assertCurrent()).toBeUndefined()
    }
    expect(reads.mock.calls.length).toBeGreaterThan(0)
    expect(
      reads.mock.calls.every(([path]) => basename(String(path)) === '.orca-managed-home')
    ).toBe(true)
    expect(mocks.getPath.mock.calls.every(([name]) => name === 'userData')).toBe(true)
    expect(mocks.getSystemHome).toHaveBeenCalled()
    expect(original.settings).toEqual(before)
    expect(fs.readdirSync(original.home)).toEqual(entries)
    expect(original.store.updateSettings).not.toHaveBeenCalled()
    expect(original.store.getAccountsSnapshot).not.toHaveBeenCalled()
    expect(original.store.listAccounts).not.toHaveBeenCalled()
    for (const method of Object.values(mocks.runtimeHome)) {
      expect(method).not.toHaveBeenCalled()
    }
  })
  it('refuses a foreign explicit home without selected-account fallback', () => {
    const original = fixture()
    const ports = createMainProcessTaskCodexAccountPorts(original.store)
    expect(() => ports.resolvePinned(join(directory, 'foreign-home'))).toThrow(UNAVAILABLE)
    expect(() => ports.resolvePinned(mocks.paths.systemHome)).toThrow(UNAVAILABLE)
    expect(ports.resolveSelected().codexHome).toBe(original.home)
  })
  it('refuses initial assembly when the original runtime-home service is missing', () => {
    const original = fixture()
    mocks.state.codexRuntimeHome = null
    expect(() => createMainProcessTaskCodexAccountPorts(original.store)).toThrow(UNAVAILABLE)
    expect(original.store.getSettings).not.toHaveBeenCalled()
    expect(mocks.getPath).not.toHaveBeenCalled()
    expect(mocks.getSystemHome).not.toHaveBeenCalled()
  })
  it('rechecks service availability for current metadata, full proof and both new lookups', () => {
    const original = fixture()
    const ports = createMainProcessTaskCodexAccountPorts(original.store)
    const scope = ports.resolvePinned(original.home)
    original.store.getSettings.mockClear()
    mocks.getPath.mockClear()
    mocks.getSystemHome.mockClear()
    mocks.state.codexRuntimeHome = null
    expect(scope.assertMetadataCurrent).toThrow(UNAVAILABLE)
    expect(scope.assertCurrent).toThrow(UNAVAILABLE)
    expect(ports.resolveSelected).toThrow(UNAVAILABLE)
    expect(() => ports.resolvePinned(original.home)).toThrow(UNAVAILABLE)
    expect(original.store.getSettings).not.toHaveBeenCalled()
    expect(mocks.getPath).not.toHaveBeenCalled()
    expect(mocks.getSystemHome).not.toHaveBeenCalled()
  })
  it.each(['settings', 'root'])(
    'checks the service again after the %s getter returns',
    (boundary) => {
      const original = fixture()
      const ports = createMainProcessTaskCodexAccountPorts(original.store)
      if (boundary === 'settings') {
        original.store.getSettings.mockImplementation(() => {
          mocks.state.codexRuntimeHome = null
          return original.settings
        })
      } else {
        mocks.getPath.mockImplementation(() => {
          mocks.state.codexRuntimeHome = null
          return mocks.paths.userData
        })
      }
      expect(() => ports.resolvePinned(original.home)).toThrow(UNAVAILABLE)
      expect(mocks.getSystemHome).not.toHaveBeenCalled()
      if (boundary === 'settings') {
        expect(mocks.getPath).not.toHaveBeenCalled()
      }
    }
  )
  it.each(['settings', 'root', 'system'])(
    'sanitizes errors from the original %s getter',
    (getter) => {
      const original = fixture()
      const ports = createMainProcessTaskCodexAccountPorts(original.store)
      const scope = ports.resolvePinned(original.home)
      const fail = () => {
        throw new Error(`private-account-path:${directory}`)
      }
      if (getter === 'settings') {
        original.store.getSettings.mockImplementation(fail)
      } else if (getter === 'root') {
        mocks.getPath.mockImplementation(fail)
      } else {
        mocks.getSystemHome.mockImplementation(fail)
      }
      expect(scope.assertCurrent).toThrow(UNAVAILABLE)
      expect(scope.assertMetadataCurrent).toThrow(UNAVAILABLE)
      expect(ports.resolveSelected).toThrow(UNAVAILABLE)
      expect(() => ports.resolvePinned(original.home)).toThrow(UNAVAILABLE)
    }
  )
  it('subscribes only to the three original account settings keys and returns the original unsubscribe', () => {
    const original = fixture()
    const ports = createMainProcessTaskCodexAccountPorts(original.store)
    const subscribe = ports.subscribe
    if (!subscribe) {
      throw new Error('Main account subscription port is required')
    }
    const first = vi.fn()
    const second = vi.fn()
    const unsubscribe = subscribe(first)
    subscribe(second)
    expect(unsubscribe).toBe(original.unsubscribers[0])
    original.notify({ theme: 'dark' })
    original.notify({ experimentalStructuredNativeChat: true })
    expect(first).not.toHaveBeenCalled()
    original.notify({ codexManagedAccounts: original.settings.codexManagedAccounts })
    original.notify({ activeCodexManagedAccountId: null })
    original.notify({ activeCodexManagedAccountIdsByRuntime: { host: null, wsl: {} } })
    expect(first).toHaveBeenCalledTimes(3)
    expect(second).toHaveBeenCalledTimes(3)
    unsubscribe()
    unsubscribe()
    original.notify({ activeCodexManagedAccountId: 'managed-row-two' })
    expect(first).toHaveBeenCalledTimes(3)
    expect(second).toHaveBeenCalledTimes(4)
    expect(original.listeners.size).toBe(1)
    expect(original.store.getSettings).not.toHaveBeenCalled()
    expect(mocks.getPath).not.toHaveBeenCalled()
    expect(mocks.getSystemHome).not.toHaveBeenCalled()
  })
  it('refuses subscription after the original service disappears without registering a listener', () => {
    const original = fixture()
    const ports = createMainProcessTaskCodexAccountPorts(original.store)
    const subscribe = ports.subscribe
    if (!subscribe) {
      throw new Error('Main account subscription port is required')
    }
    mocks.state.codexRuntimeHome = null
    expect(() => subscribe(vi.fn())).toThrow(UNAVAILABLE)
    expect(original.listeners.size).toBe(0)
    expect(original.store.onSettingsChanged).not.toHaveBeenCalled()
  })
  it('keeps metadata checks free of filesystem reads while checking the original live getters', () => {
    const original = fixture()
    const ports = createMainProcessTaskCodexAccountPorts(original.store)
    const scope = ports.resolvePinned(original.home)
    const reads = vi.mocked(fs.readFileSync)
    reads.mockClear()
    original.store.getSettings.mockClear()
    mocks.getPath.mockClear()
    mocks.getSystemHome.mockClear()
    expect(scope.assertMetadataCurrent()).toBeUndefined()
    expect(reads).not.toHaveBeenCalled()
    expect(original.store.getSettings).toHaveBeenCalledOnce()
    expect(mocks.getPath).toHaveBeenCalledOnce()
    expect(mocks.getSystemHome).toHaveBeenCalledOnce()
    original.settings.activeCodexManagedAccountId = null
    original.settings.activeCodexManagedAccountIdsByRuntime = { host: null, wsl: {} }
    expect(scope.assertMetadataCurrent).toThrow(UNAVAILABLE)
    expect(reads).not.toHaveBeenCalled()
  })
})
