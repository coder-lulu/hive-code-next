import { useEffect } from 'react'
import { LOCAL_EXECUTION_HOST_ID, toRuntimeExecutionHostId } from '../../../shared/execution-host'
import { lastVerifiedRuntimeStatus } from '../../../shared/runtime-host-status'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import {
  loadHostStructuredAgents,
  readHostStructuredAgentsForRuntime,
  retainHostStructuredAgents
} from './host-structured-agents'
import {
  ensureLocalRuntimeCapabilities,
  subscribeLocalRuntimeCapabilitiesKnown
} from './local-runtime-capabilities'
import { localStructuredChatsInUse } from './local-structured-chats'

async function syncLocalHost(settings: AppState['settings']): Promise<void> {
  if (!(await localStructuredChatsInUse(settings))) {
    return
  }
  await loadHostStructuredAgents(
    LOCAL_EXECUTION_HOST_ID,
    await ensureLocalRuntimeCapabilities(),
    null
  )
}

function syncPairedHosts(statuses: AppState['runtimeStatusByEnvironmentId']): void {
  const hostIds = new Set<string>([LOCAL_EXECUTION_HOST_ID])
  for (const [environmentId, entry] of statuses) {
    const executionHostId = toRuntimeExecutionHostId(environmentId)
    hostIds.add(executionHostId)
    const status = lastVerifiedRuntimeStatus(entry)
    if (status) {
      void loadHostStructuredAgents(executionHostId, status.capabilities, status.runtimeId)
    }
  }
  retainHostStructuredAgents(hostIds)
}

/** Catalog availability serves explicit chat/history requests independently of launch defaults.
 *  Reads remain fenced by the host's advertised capability and current runtime identity. */
export function installHostStructuredAgentsSync(): () => void {
  const initial = useAppStore.getState()
  void syncLocalHost(initial.settings)
  syncPairedHosts(initial.runtimeStatusByEnvironmentId)
  const stopLocal = subscribeLocalRuntimeCapabilitiesKnown(() => {
    if (!readHostStructuredAgentsForRuntime(LOCAL_EXECUTION_HOST_ID, null)) {
      void syncLocalHost(useAppStore.getState().settings)
    }
  })
  const stopStore = useAppStore.subscribe((state, previousState) => {
    if (state.settings !== previousState.settings) {
      void syncLocalHost(state.settings)
    }
    if (state.runtimeStatusByEnvironmentId !== previousState.runtimeStatusByEnvironmentId) {
      syncPairedHosts(state.runtimeStatusByEnvironmentId)
    }
  })
  return () => {
    stopLocal()
    stopStore()
  }
}

export function useHostStructuredAgentsSync(): void {
  useEffect(() => installHostStructuredAgentsSync(), [])
}
