import { beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_DISPLAY_NAME } from '../../shared/brand'

const safeStorageMock = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((plainText: string) => Buffer.from(`os-sealed:${plainText}`)),
  decryptString: vi.fn((cipher: Buffer) => cipher.toString().slice('os-sealed:'.length)),
  getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret')
}))

vi.mock('electron', () => ({ safeStorage: safeStorageMock }))

const { ElectronSecretStore } = await import('./electron-secret-store')

describe('ElectronSecretStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    safeStorageMock.getSelectedStorageBackend.mockReturnValue('gnome_libsecret')
  })

  function withDesktop<T>(desktop: string | undefined, run: () => T): T {
    const original = process.env.XDG_CURRENT_DESKTOP
    if (desktop === undefined) {
      delete process.env.XDG_CURRENT_DESKTOP
    } else {
      process.env.XDG_CURRENT_DESKTOP = desktop
    }
    try {
      return run()
    } finally {
      if (original === undefined) {
        delete process.env.XDG_CURRENT_DESKTOP
      } else {
        process.env.XDG_CURRENT_DESKTOP = original
      }
    }
  }

  function withPlatform<T>(platform: NodeJS.Platform, run: () => T): T {
    const original = process.platform
    Object.defineProperty(process, 'platform', { configurable: true, value: platform })
    try {
      return run()
    } finally {
      Object.defineProperty(process, 'platform', { configurable: true, value: original })
    }
  }

  describe('at-rest protection reporting', () => {
    it.each(['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'])(
      'reports no gap when the Linux backend is %s',
      (backend) => {
        safeStorageMock.getSelectedStorageBackend.mockReturnValue(backend)
        withPlatform('linux', () => {
          expect(new ElectronSecretStore().describeProtectionGap()).toBeNull()
        })
      }
    )

    it('reports a gap for the Linux basic_text backend, which protects nothing', () => {
      safeStorageMock.getSelectedStorageBackend.mockReturnValue('basic_text')
      withPlatform('linux', () => {
        const gap = new ElectronSecretStore().describeProtectionGap()
        expect(gap).toMatch(/built-in key/)
        expect(gap).toMatch(/gnome-keyring|kwallet/)
        expect(gap).toContain(APP_DISPLAY_NAME)
        expect(gap).not.toMatch(/\bOrca\b/)
      })
    })

    it('keeps sealing AVAILABLE on basic_text so stored credentials still decrypt', () => {
      // Why this matters more than the warning: flipping isEncryptionAvailable() would
      // make decryptWithStatus() stop attempting and return every stored secret as
      // empty. The gap is a trust signal, never a capability switch.
      safeStorageMock.getSelectedStorageBackend.mockReturnValue('basic_text')
      withPlatform('linux', () => {
        const store = new ElectronSecretStore()
        expect(store.isEncryptionAvailable()).toBe(true)
        expect(store.decryptString(store.encryptString('linear-token'))).toBe('linear-token')
      })
    })

    it.each(['darwin', 'win32'] as const)(
      'does not consult the Linux backend on %s',
      (platform) => {
        withPlatform(platform, () => {
          expect(new ElectronSecretStore().describeProtectionGap()).toBeNull()
        })
        expect(safeStorageMock.getSelectedStorageBackend).not.toHaveBeenCalled()
      }
    )

    it('reports an actionable gap when the Linux backend probe is absent', () => {
      // Delete from the live mock because the imported module retains its object reference.
      const probe = safeStorageMock.getSelectedStorageBackend
      // @ts-expect-error deleting a required member is the condition under test
      delete safeStorageMock.getSelectedStorageBackend
      try {
        withPlatform('linux', () => {
          const store = new ElectronSecretStore()
          expect(store.isEncryptionAvailable()).toBe(true)
          expect(store.describeProtectionGap()).toMatch(/could not be verified/)
          expect(store.describeProtectionGap()).toMatch(/gnome-keyring or kwallet/)
        })
      } finally {
        safeStorageMock.getSelectedStorageBackend = probe
      }
    })

    it('reports an actionable gap when the Linux backend probe throws', () => {
      safeStorageMock.getSelectedStorageBackend.mockImplementation(() => {
        throw new Error('backend unavailable')
      })
      withPlatform('linux', () => {
        expect(new ElectronSecretStore().describeProtectionGap()).toMatch(/could not be verified/)
      })
    })

    it.each(['unknown', 'new-backend'])(
      'reports an actionable gap for the unverified Linux backend %s',
      (backend) => {
        safeStorageMock.getSelectedStorageBackend.mockReturnValue(backend)
        withPlatform('linux', () => {
          const store = new ElectronSecretStore()
          expect(store.isEncryptionAvailable()).toBe(true)
          expect(store.decryptString(Buffer.from('os-sealed:legacy-token'))).toBe('legacy-token')
          expect(store.describeProtectionGap()).toMatch(/could not be verified/)
        })
      }
    )

    it('reports the missing-keyring gap before considering the backend', () => {
      safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
      withPlatform('linux', () => {
        expect(new ElectronSecretStore().describeProtectionGap()).toMatch(/keyring is unavailable/)
      })
    })

    // Why these three: on Hyprland/sway/river/niri the desktop is unrecognised, so the
    // backend is basic_text AND sealing is unavailable — and the old text told those users
    // to install a keyring that gnome-keyring was already serving the whole time.
    it('does not blame a missing keyring when the desktop was simply not recognised', () => {
      safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
      safeStorageMock.getSelectedStorageBackend.mockReturnValue('basic_text')
      withPlatform('linux', () => {
        const gap = new ElectronSecretStore().describeProtectionGap()
        expect(gap).toMatch(/could not tell which keyring service/)
        expect(gap).toMatch(/already running/)
        expect(gap).not.toMatch(/Install and unlock/)
      })
    })

    it('names the desktop in the unrecognised-desktop gap, so support can act on the log', () => {
      safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
      safeStorageMock.getSelectedStorageBackend.mockReturnValue('basic_text')
      withDesktop('Hyprland', () => {
        withPlatform('linux', () => {
          expect(new ElectronSecretStore().describeProtectionGap()).toContain(
            'XDG_CURRENT_DESKTOP=Hyprland'
          )
        })
      })
    })

    it('omits the parenthetical when no desktop is set rather than printing an empty one', () => {
      safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
      safeStorageMock.getSelectedStorageBackend.mockReturnValue('basic_text')
      withDesktop(undefined, () => {
        withPlatform('linux', () => {
          const gap = new ElectronSecretStore().describeProtectionGap()
          expect(gap).not.toMatch(/XDG_CURRENT_DESKTOP/)
          expect(gap).toContain('this desktop uses, so new secrets cannot be saved securely')
        })
      })
    })

    it('still blames the keyring when a real backend was selected but cannot seal', () => {
      safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
      safeStorageMock.getSelectedStorageBackend.mockReturnValue('gnome_libsecret')
      withPlatform('linux', () => {
        expect(new ElectronSecretStore().describeProtectionGap()).toMatch(/Install and unlock/)
      })
    })
  })

  // Why this shape: the whole safety argument for the SecretStore refactor is that the
  // desktop byte path did not change. That is only true if this adapter forwards
  // verbatim — same argument, same return value, no re-encoding.
  it('forwards encryptString to safeStorage and returns its buffer unchanged', () => {
    const sealed = new ElectronSecretStore().encryptString('token')
    expect(safeStorageMock.encryptString).toHaveBeenCalledExactlyOnceWith('token')
    expect(sealed).toBe(safeStorageMock.encryptString.mock.results[0]!.value)
  })

  it('forwards decryptString to safeStorage and returns its string unchanged', () => {
    const cipher = Buffer.from('os-sealed:token')
    expect(new ElectronSecretStore().decryptString(cipher)).toBe('token')
    expect(safeStorageMock.decryptString).toHaveBeenCalledExactlyOnceWith(cipher)
  })

  // Why the narrower claim: safeStorage is mocked here, so this proves the adapter
  // pairs encrypt/decrypt without mangling the buffer — NOT that credentials sealed by
  // a previous build still open. Real-ciphertext compatibility needs a captured fixture.
  it('pairs encryptString and decryptString without altering the payload', () => {
    const store = new ElectronSecretStore()
    expect(store.decryptString(store.encryptString('linear-token'))).toBe('linear-token')
  })

  it('reports availability from safeStorage rather than caching it', () => {
    const store = new ElectronSecretStore()
    expect(store.isEncryptionAvailable()).toBe(true)
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    expect(store.isEncryptionAvailable()).toBe(false)
  })

  it('has no reason to give while sealing works', () => {
    expect(new ElectronSecretStore().describeProtectionGap()).toBeNull()
  })

  it('names the missing facility when sealing is unavailable', () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const reason = new ElectronSecretStore().describeProtectionGap()
    if (process.platform === 'linux') {
      expect(reason).toMatch(/keyring is unavailable.*cannot be saved securely/)
    } else {
      expect(reason).toMatch(/keychain is unavailable.*cannot be saved securely/)
    }
  })
})
