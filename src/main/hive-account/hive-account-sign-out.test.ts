import { describe, expect, it, vi } from 'vitest'
import { completeHiveAccountSignOut } from './hive-account-sign-out'

describe('account sign-out storage failures', () => {
  it.each(['EPERM', 'EBUSY'])(
    'still revokes the old session after %s prevents deletion',
    async (code) => {
      const error = Object.assign(new Error('credential deletion failed'), { code })
      const revokeRemote = vi.fn().mockResolvedValue(undefined)

      await expect(
        completeHiveAccountSignOut({
          hasStoredSession: true,
          clearLocal: () => {
            throw error
          },
          revokeRemote
        })
      ).rejects.toBe(error)
      expect(revokeRemote).toHaveBeenCalledOnce()
    }
  )

  it('preserves the storage failure when remote revocation also fails', async () => {
    const error = new Error('credential is locked')
    const revokeRemote = vi.fn().mockRejectedValue(new Error('Cloud unavailable'))

    await expect(
      completeHiveAccountSignOut({
        hasStoredSession: true,
        clearLocal: () => {
          throw error
        },
        revokeRemote
      })
    ).rejects.toBe(error)
    expect(revokeRemote).toHaveBeenCalledOnce()
  })

  it.each([true, false])(
    'does not report deletion success without a revoke callback (stored=%s)',
    async (hasStoredSession) => {
      const error = new Error('credential deletion failed')
      await expect(
        completeHiveAccountSignOut({
          hasStoredSession,
          clearLocal: () => {
            throw error
          },
          revokeRemote: null
        })
      ).rejects.toBe(error)
    }
  )

  it('clears synchronously and never deletes a new login when revocation settles', async () => {
    let finishRevocation: () => void = () => {}
    const clearLocal = vi.fn()
    const revokeRemote = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRevocation = resolve
        })
    )
    const signOut = completeHiveAccountSignOut({ hasStoredSession: true, clearLocal, revokeRemote })

    expect(clearLocal).toHaveBeenCalledOnce()
    expect(revokeRemote).toHaveBeenCalledOnce()
    finishRevocation()
    await expect(signOut).resolves.toMatchObject({ status: 'remote-and-local' })
    expect(clearLocal).toHaveBeenCalledOnce()
  })
})
