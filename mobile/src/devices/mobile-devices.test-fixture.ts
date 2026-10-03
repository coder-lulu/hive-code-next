import type { HostCatalogEntry, HostProfile } from '../transport/types'
import { projectMobileDevices } from './mobile-devices-model'

export const deviceCatalog: HostCatalogEntry[] = ['开发电脑', 'MacBook Pro', '开发服务器'].map(
  (name, index) => {
    const id = `device-${index}`
    const profile: HostProfile = {
      id,
      name,
      endpoint: 'ws://192.168.1.10:9800',
      deviceToken: 'test-token',
      publicKeyB64: 'test-key',
      lastConnected: 1_000
    }
    return {
      ...profile,
      profile,
      credentialStatus: 'ready',
      accessSources: index === 2 ? ['account-claimed'] : ['manual-pairing']
    }
  }
)
export const deviceProjection = {
  catalog: deviceCatalog,
  states: { 'device-0': 'connected' as const, 'device-1': 'reconnecting' as const },
  selectedId: 'device-0',
  autoConnectHostIds: [],
  attempts: {},
  lastConnected: {},
  pendingPaths: {},
  pairingRejected: {},
  signedOut: {}
}
export const testDevices = () => projectMobileDevices(deviceProjection)
