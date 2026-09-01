import type { HiveRuntimeCloudAccountClient } from './hive-runtime-cloud-account-client'
import { HiveRuntimeDisplayNameCoordinator } from './hive-runtime-display-name-coordinator'
import { HiveRuntimeDisplayNamePendingStore } from './hive-runtime-display-name-pending-store'

type DisplayNameClient = Partial<
  Pick<HiveRuntimeCloudAccountClient, 'getOwnedRuntime' | 'updateOwnedRuntimeDisplayName'>
>

export function createHiveRuntimeDisplayNameCoordinator(args: {
  client: DisplayNameClient | null
  userDataPath?: string
  now: () => number
  onChanged: () => void
  requestDirectoryRefresh: () => void
}): HiveRuntimeDisplayNameCoordinator | null {
  const { client, userDataPath } = args
  if (!client?.getOwnedRuntime || !client.updateOwnedRuntimeDisplayName || !userDataPath) {
    return null
  }
  try {
    return new HiveRuntimeDisplayNameCoordinator(
      new HiveRuntimeDisplayNamePendingStore(userDataPath),
      {
        getOwnedRuntime: client.getOwnedRuntime.bind(client),
        updateOwnedRuntimeDisplayName: client.updateOwnedRuntimeDisplayName.bind(client)
      },
      args.now,
      args.onChanged,
      args.requestDirectoryRefresh
    )
  } catch {
    // A corrupt pending-alias file must disable only cloud rename synchronization;
    // Runtime discovery and local pairing remain available.
    return null
  }
}
