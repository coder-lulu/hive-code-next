import { APP_DISPLAY_NAME } from '../../shared/brand'
import {
  EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY,
  type HiveAccountRuntimeDirectoryState
} from '../../shared/hive-runtime-cloud'
import { installHiveAccountRuntimeAccess } from '../hive-runtime-cloud/hive-account-runtime-access'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../shared/constants'
import { encodePairingOffer } from '../../shared/pairing'
import {
  addEnvironmentFromPairingCode,
  getEnvironmentStorePath,
  listEnvironments,
  removeEnvironment
} from '../../shared/runtime-environment-store'
import type { GlobalSettings } from '../../shared/global-settings-types'
import type { Store } from '../persistence'
import {
  readSettingsWithRuntimeEnvironmentPreference,
  watchRuntimeEnvironmentPreference
} from './runtime-environment-preference'

let userDataPath: string

beforeEach(() => {
  userDataPath = mkdtempSync(join(tmpdir(), 'orca-removed-preference-'))
})

afterEach(() => {
  rmSync(userDataPath, { recursive: true, force: true })
})

function preferenceStore(activeId: string | null) {
  let settings = { ...getDefaultSettings(userDataPath), activeRuntimeEnvironmentId: activeId }
  const updateSettings = vi.fn<Store['updateSettings']>((updates) => {
    settings = { ...settings, ...updates }
    return settings
  })
  return { getSettings: () => settings, updateSettings }
}

function saveEnvironment(name = 'server') {
  return addEnvironmentFromPairingCode(userDataPath, {
    name,
    pairingCode: encodePairingOffer({
      v: 2,
      endpoint: 'ws://127.0.0.1:59999',
      deviceToken: 'test-token',
      publicKeyB64: Buffer.alloc(32, 1).toString('base64')
    })
  })
}

describe('Active Server after a saved host is removed', () => {
  it('survives a failed watch installation and repairs on the next settings read', () => {
    const environment = saveEnvironment()
    const store = preferenceStore(environment.id)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let stopWatching: (() => void) | undefined
    rmSync(userDataPath, { recursive: true })
    try {
      expect(() => {
        stopWatching = watchRuntimeEnvironmentPreference(store, userDataPath)
      }).not.toThrow()
      expect(store.getSettings().activeRuntimeEnvironmentId).toBe(environment.id)
      mkdirSync(userDataPath)
      writeFileSync(getEnvironmentStorePath(userDataPath), '{"version":1,"environments":[]}')
      expect(
        readSettingsWithRuntimeEnvironmentPreference(store, userDataPath).activeRuntimeEnvironmentId
      ).toBeNull()
    } finally {
      stopWatching?.()
      warning.mockRestore()
    }
  })

  it('notifies the running renderer when the CLI atomically replaces the registry', async () => {
    const environment = saveEnvironment()
    const store = preferenceStore(environment.id)
    const stopWatching = watchRuntimeEnvironmentPreference(store, userDataPath)
    try {
      await new Promise<void>((resolve) => setImmediate(resolve))
      removeEnvironment(userDataPath, environment.id)
      await vi.waitFor(() => expect(store.getSettings().activeRuntimeEnvironmentId).toBeNull(), {
        timeout: 5_000
      })
      expect(store.updateSettings).toHaveBeenCalledWith(
        { activeRuntimeEnvironmentId: null },
        { notifyListeners: true }
      )
    } finally {
      stopWatching()
    }
  })

  it('repairs a CLI removal before settings can route to the deleted pairing', () => {
    const environment = saveEnvironment()
    const store = preferenceStore(environment.id)
    const before = store.getSettings()
    removeEnvironment(userDataPath, environment.id)

    const settings = readSettingsWithRuntimeEnvironmentPreference(store, userDataPath)

    expect(settings).toEqual({ ...before, activeRuntimeEnvironmentId: null })
    expect(store.getSettings().activeRuntimeEnvironmentId).toBeNull()
    expect(store.updateSettings).toHaveBeenCalledWith(
      { activeRuntimeEnvironmentId: null },
      { notifyListeners: true }
    )
    readSettingsWithRuntimeEnvironmentPreference(store, userDataPath)
    expect(store.updateSettings).toHaveBeenCalledOnce()
  })

  it('does not select a same-name replacement or another saved server', () => {
    const removed = saveEnvironment()
    const store = preferenceStore(removed.id)
    removeEnvironment(userDataPath, removed.id)
    const replacement = saveEnvironment()
    saveEnvironment('other')

    expect(replacement.id).not.toBe(removed.id)
    expect(
      readSettingsWithRuntimeEnvironmentPreference(store, userDataPath).activeRuntimeEnvironmentId
    ).toBeNull()
  })

  it('keeps a saved host even when its endpoint is offline', () => {
    const environment = saveEnvironment()
    const store = preferenceStore(environment.id)
    const settings = store.getSettings()

    expect(readSettingsWithRuntimeEnvironmentPreference(store, userDataPath)).toBe(settings)
    expect(store.updateSettings).not.toHaveBeenCalled()
  })

  it.each(['missing', 'corrupt', 'unsupported'] as const)(
    'preserves the preference when the registry is %s',
    (kind) => {
      const environment = saveEnvironment()
      const store = preferenceStore(environment.id)
      const registryPath = getEnvironmentStorePath(userDataPath)
      if (kind === 'missing') {
        rmSync(registryPath)
      } else {
        writeFileSync(registryPath, kind === 'corrupt' ? '{' : '{"version":99,"environments":[]}')
      }

      expect(readSettingsWithRuntimeEnvironmentPreference(store, userDataPath)).toBe(
        store.getSettings()
      )
      expect(store.updateSettings).not.toHaveBeenCalled()
    }
  )

  it('keeps local defaults without requiring a pairing registry', () => {
    const store = preferenceStore(null)
    expect(readSettingsWithRuntimeEnvironmentPreference(store, userDataPath)).toBe(
      store.getSettings()
    )
    expect(store.updateSettings).not.toHaveBeenCalled()
  })

  it('does not swallow a settings write failure after confirming removal', () => {
    const environment = saveEnvironment()
    const store = preferenceStore(environment.id)
    removeEnvironment(userDataPath, environment.id)
    store.updateSettings.mockImplementation((): GlobalSettings => {
      throw new Error('settings write failed')
    })

    expect(() => readSettingsWithRuntimeEnvironmentPreference(store, userDataPath)).toThrow(
      'settings write failed'
    )
  })

  it('distinguishes a new profile from an unavailable registry for repair reads', () => {
    expect(listEnvironments(userDataPath)).toEqual([])
    expect(() => listEnvironments(userDataPath, { requireStoreFile: true })).toThrow(
      `Could not read ${APP_DISPLAY_NAME} environments`
    )
  })
})

describe('account-only active Runtime preference', () => {
  const accountId = 'account-runtime:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  function installDirectory(state: HiveAccountRuntimeDirectoryState) {
    return installHiveAccountRuntimeAccess({
      getLocalRuntimeRecordId: () => null,
      directory: { getState: () => state },
      transport: { getStatus: vi.fn(), call: vi.fn(), subscribe: vi.fn(), disconnect: vi.fn() }
    })
  }
  it.each(['LOADING', 'STALE', 'ERROR', 'SIGNED_OUT'] as const)(
    'keeps the account route when the directory is %s',
    (status) => {
      saveEnvironment()
      const store = preferenceStore(accountId)
      const settings = store.getSettings()
      const uninstall = installDirectory({ ...EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY, status })
      try {
        expect(readSettingsWithRuntimeEnvironmentPreference(store, userDataPath)).toBe(settings)
        expect(store.updateSettings).not.toHaveBeenCalled()
      } finally {
        uninstall()
      }
    }
  )
  it('keeps an account route when the account service is unavailable', () => {
    saveEnvironment()
    const store = preferenceStore(accountId)
    expect(readSettingsWithRuntimeEnvironmentPreference(store, userDataPath)).toBe(
      store.getSettings()
    )
    expect(store.updateSettings).not.toHaveBeenCalled()
  })
  it('keeps an existing account-only host in a ready directory', () => {
    saveEnvironment()
    const store = preferenceStore(accountId)
    const settings = store.getSettings()
    const uninstall = installDirectory({
      ...EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY,
      status: 'READY',
      items: [
        {
          runtimeRecordId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          status: 'CLAIMED',
          runtimeVersion: '1.0.0',
          runtimeProtocolVersion: 3,
          capabilities: [],
          resourceVersion: 1,
          ownershipEpoch: 1,
          cloudDisplayName: null,
          cloudDisplayNameVersion: 1,
          createdAt: 1,
          updatedAt: 1,
          claimedAt: 1,
          presence: 'ONLINE',
          readiness: 'READY',
          readinessReasonCode: null,
          lastHeartbeatAt: 1,
          observedAt: 1,
          freeDiskBytes: 1024,
          clientAuthMode: 'IDENTITY_PROOF',
          credentialState: 'ACTIVE',
          connectionCapabilities: ['hive-relay']
        }
      ]
    })
    try {
      expect(readSettingsWithRuntimeEnvironmentPreference(store, userDataPath)).toBe(settings)
      expect(store.updateSettings).not.toHaveBeenCalled()
    } finally {
      uninstall()
    }
  })

  it('clears an account route only when a ready directory proves its removal', () => {
    saveEnvironment()
    const store = preferenceStore(accountId)
    const uninstall = installDirectory({ ...EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY, status: 'READY' })
    try {
      expect(
        readSettingsWithRuntimeEnvironmentPreference(store, userDataPath).activeRuntimeEnvironmentId
      ).toBeNull()
      expect(store.updateSettings).toHaveBeenCalledOnce()
    } finally {
      uninstall()
    }
  })
})
