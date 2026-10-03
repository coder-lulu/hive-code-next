import { createContext, useContext } from 'react'
import type { TaskProvider } from '../tasks/mobile-task-providers'
import type { RpcClient } from '../transport/rpc-client'
import type { HostCatalogEntry, HostProfile } from '../transport/types'
import type { HomeResumeCard } from '../worktree/home-resume-card'
import type { useMobileHomeData } from './use-mobile-home-data'
import type { MobileHomeConnectionMethod } from './mobile-home-connection-content'

export type MobileHomeContextValue = {
  data: ReturnType<typeof useMobileHomeData>
  selectedRuntime: HostCatalogEntry | null
  selectedRuntimeClient: RpcClient | null
  activeConnectedHost: HostProfile | null
  connectionMethod: MobileHomeConnectionMethod
  setConnectionMethod: (method: MobileHomeConnectionMethod) => void
  openRuntimeSelector: (accountOnly?: boolean) => void
  openMenu: () => void
  selectRuntime: (id: string) => void
  openHost: (host: HostCatalogEntry) => void
  openHostActions: (host: HostCatalogEntry) => void
  openResume: (card: HomeResumeCard) => void
  openTasks: (provider?: TaskProvider) => void
  openAccounts: (hostId: string) => void
}

export const MobileHomeContext = createContext<MobileHomeContextValue | null>(null)

export function useMobileHomeContext(): MobileHomeContextValue {
  const value = useContext(MobileHomeContext)
  if (!value) {
    throw new Error('Mobile home pages require the tab layout')
  }
  return value
}
