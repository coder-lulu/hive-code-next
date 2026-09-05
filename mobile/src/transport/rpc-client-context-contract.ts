import { createContext, useContext } from 'react'
import type { HostClientAcquisition } from './host-client-acquisition-registry'
import type { RpcClient } from './rpc-client'
import type { MobileConnectionPath } from './stable-logical-rpc-client'
import type { ConnectionState, HostProfile } from './types'

export type RpcClientContextValue = {
  acquire: (
    hostId: string,
    acquisition: HostClientAcquisition,
    host?: HostProfile
  ) => RpcClient | null
  release: (hostId: string, acquisition: HostClientAcquisition) => void
  releaseAndCloseIfUnused: (hostId: string, acquisition: HostClientAcquisition) => void
  closeIfUnused: (hostId: string) => void
  forceReconnect: (hostId: string) => Promise<void>
  refreshHostClient: (hostId: string) => void
  forgetHostClient: (hostId: string) => void
  disconnectHostClient: (hostId: string) => void
  getState: (hostId: string) => ConnectionState
  getKnownState: (hostId: string) => ConnectionState | null
  getClientId: (hostId: string) => string | null
  getReconnectAttempt: (hostId: string) => number
  getLastConnectedAt: (hostId: string) => number | null
  getActivePath: (hostId: string) => MobileConnectionPath
  getPendingPath: (hostId: string) => MobileConnectionPath | null
  isPairingRejected: (hostId: string) => boolean
  isHostSignedOut: (hostId: string) => boolean
  subscribeHostState: (hostId: string, listener: (state: ConnectionState) => void) => () => void
  getAllClients: () => { hostId: string; client: RpcClient }[]
  subscribeAllHosts: (listener: () => void) => () => void
  primeHosts: (hosts: HostProfile[]) => void
}

export const RpcClientContext = createContext<RpcClientContextValue | null>(null)

export function useRpcClientContext(): RpcClientContextValue {
  const ctx = useContext(RpcClientContext)
  if (!ctx) {
    throw new Error('useHostClient must be used inside <RpcClientProvider>')
  }
  return ctx
}
