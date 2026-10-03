import { useDashboardPopoutBridge } from './useDashboardPopoutBridge'

/** Desktop pop-out IPC and snapshot subscriptions. */
export default function DashboardPopoutBridge(): null {
  useDashboardPopoutBridge(true)
  return null
}
