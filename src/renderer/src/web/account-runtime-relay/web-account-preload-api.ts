import type { PreloadApi } from '../../../../preload/api-types'
import type { HiveAccountState } from '../../../../shared/hive-account'
import type { WebAccountBootstrap } from './WebAccountConnect'

export function createWebAccountPreloadApi(
  getAccount: () => WebAccountBootstrap | null,
  closeClients: () => void
): PreloadApi['hiveAccount'] {
  const state = (): HiveAccountState => ({
    configured: getAccount() !== null,
    status: getAccount() ? 'signed-in' : 'unconfigured',
    persistence: 'none'
  })
  return {
    getLoginCapabilities: async () => {
      const account = getAccount()
      if (!account) {
        throw new Error('Sign in through HiveCloud to connect an account Runtime.')
      }
      return account.session.loginCapabilities()
    },
    getState: async () => state(),
    signIn: async () => {
      window.location.assign('https://console.hivekernel.com/login?redirect=%2Fruntime%2F')
      return { status: 'cancelled', state: state() }
    },
    refresh: async () => {
      const account = getAccount()
      if (account && (await account.session.restore())) {
        return { status: 'refreshed', state: state() }
      }
      closeClients()
      return {
        status: 'signed-out',
        state: { configured: true, status: 'signed-out', persistence: 'none' }
      }
    },
    signOut: async () => {
      const account = getAccount()
      if (account) {
        closeClients()
        try {
          await account.session.signOut()
        } finally {
          window.location.assign('/runtime/')
        }
      }
      return {
        status: account ? 'remote-and-local' : 'already-signed-out',
        state: { configured: true, status: 'signed-out', persistence: 'none' }
      }
    },
    onStateChanged: () => () => {}
  }
}
