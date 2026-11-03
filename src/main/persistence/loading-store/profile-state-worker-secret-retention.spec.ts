import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSecretStore, setSecretStore } from '../../../shared/secret-store'
import { fixture } from './profile-state-delayed-authority-fixture'

export function registerProfileStateWorkerSecretRetentionTests(): void {
  let encryptionAvailable = true
  let previousSecretStore: ReturnType<typeof getSecretStore>
  const ciphertext = (plaintext: string) => Buffer.from(`sealed:${plaintext}`).toString('base64')

  beforeEach(() => {
    encryptionAvailable = true
    previousSecretStore = getSecretStore()
    setSecretStore({
      isEncryptionAvailable: () => encryptionAvailable,
      encryptString: (value) => Buffer.from(`sealed:${value}`),
      decryptString: (value) => value.toString().slice('sealed:'.length),
      describeProtectionGap: () => null
    })
  })
  afterEach(() => setSecretStore(previousSecretStore))

  describe.each(['opencodeSessionCookie'] as const)(
    'Store %s retention across worker acknowledgements',
    (setting) => {
      it('does not restore ciphertext cleared while its commit acknowledgement was pending', async () => {
        const { store, authority, readState } = await fixture()
        store.updateSettings({ [setting]: 'durable' })
        await store.flushPendingOrThrowAsync()
        const gate = authority.pause()
        store.updateSettings({ [setting]: 'in-flight' })
        const write = store.flushPendingOrThrowAsync({ drainToStableGeneration: false })
        await gate.started.promise
        store.updateSettings({ [setting]: '' })
        encryptionAvailable = false
        gate.finish.resolve()
        await write
        await store.flushPendingOrThrowAsync()
        expect(readState().settings[setting]).toBe('')
        expect(store.getSettings()[setting]).toBe('')
      })

      it('retains confirmed ciphertext until a newer secret can be encrypted', async () => {
        const { store, authority, readState } = await fixture()
        store.updateSettings({ [setting]: 'durable' })
        await store.flushPendingOrThrowAsync()
        const gate = authority.pause()
        store.updateSettings({ [setting]: 'in-flight' })
        const write = store.flushPendingOrThrowAsync({ drainToStableGeneration: false })
        await gate.started.promise
        store.updateSettings({ [setting]: 'newer' })
        encryptionAvailable = false
        gate.finish.resolve()
        await write
        await store.flushPendingOrThrowAsync()
        expect(readState().settings[setting]).toBe(ciphertext('in-flight'))
        expect(store.getSettings()[setting]).toBe('newer')
        encryptionAvailable = true
        store.updateSettings({ theme: 'dark' })
        await store.flushPendingOrThrowAsync()
        expect(readState().settings[setting]).toBe(ciphertext('newer'))
      })

      it('retains the earlier ciphertext after a failed write and retries newer plaintext', async () => {
        const { store, authority, readState } = await fixture()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        store.updateSettings({ [setting]: 'durable' })
        await store.flushPendingOrThrowAsync()
        const gate = authority.pause()
        store.updateSettings({ [setting]: 'failed' })
        const write = store.flushPendingOrThrowAsync({ drainToStableGeneration: false })
        const failure = expect(write).rejects.toThrow('disk refused')
        await gate.started.promise
        store.updateSettings({ [setting]: 'newer' })
        encryptionAvailable = false
        gate.finish.reject(new Error('disk refused'))
        await failure
        await store.flushPendingOrThrowAsync()
        expect(readState().settings[setting]).toBe(ciphertext('durable'))
        encryptionAvailable = true
        store.updateSettings({ theme: 'dark' })
        await store.flushPendingOrThrowAsync()
        expect(readState().settings[setting]).toBe(ciphertext('newer'))
      })
    }
  )

  describe('worker protected settings serialization', () => {
    it.each(['selective', 'complete'] as const)(
      'seals the cookie and excludes retired Go credentials in a %s SQLite write',
      async (mode) => {
        const initialSettings = {
          opencodeSessionCookie: '',
          opencodeGoApiKey: ciphertext('legacy-go-key')
        }
        const { store, authority, readState } = await fixture(initialSettings)
        const selectiveWrite = vi.spyOn(authority, 'writeSerializedDomains')
        const completeWrite = vi.spyOn(authority, 'writeCompleteSerializedDomains')
        const secrets = {
          opencodeSessionCookie: 'cookie-only-plaintext',
          opencodeGoApiKey: 'retired-write-is-ignored'
        }
        store.updateSettings(secrets)
        if (mode === 'complete') {
          store.updateOnboarding({ outcome: 'completed' })
        }
        await store.flushPendingOrThrowAsync()
        expect(selectiveWrite).toHaveBeenCalledTimes(mode === 'selective' ? 1 : 0)
        expect(completeWrite).toHaveBeenCalledTimes(mode === 'complete' ? 1 : 0)
        const persisted = readState()
        expect(persisted.settings).toMatchObject({
          opencodeSessionCookie: ciphertext(secrets.opencodeSessionCookie)
        })
        expect(persisted.settings).not.toHaveProperty('opencodeGoApiKey')
        for (const plaintext of Object.values(secrets)) {
          expect(JSON.stringify(persisted)).not.toContain(plaintext)
        }
        expect(store.getSettings().opencodeSessionCookie).toBe(secrets.opencodeSessionCookie)
        expect(store.getSettings()).not.toHaveProperty('opencodeGoApiKey')
      }
    )
  })

  it('does not restore retired Go ciphertext from a pending worker acknowledgement', async () => {
    const initialSettings = {
      opencodeSessionCookie: '',
      opencodeGoApiKey: ciphertext('legacy-go-key')
    }
    const { store, authority, readState } = await fixture(initialSettings)
    const gate = authority.pause()
    store.updateSettings({ theme: 'dark' })
    const write = store.flushPendingOrThrowAsync({ drainToStableGeneration: false })
    await gate.started.promise
    encryptionAvailable = false
    gate.finish.resolve()
    await write
    await store.flushPendingOrThrowAsync()
    expect(readState().settings).not.toHaveProperty('opencodeGoApiKey')
    expect(store.getSettings()).not.toHaveProperty('opencodeGoApiKey')
    encryptionAvailable = true
    store.updateSettings({ theme: 'light' })
    await store.flushPendingOrThrowAsync()
    expect(readState().settings).not.toHaveProperty('opencodeGoApiKey')
  })
}
