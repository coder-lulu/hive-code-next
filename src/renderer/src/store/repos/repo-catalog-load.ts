import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import { getRuntimeTargetHostId } from '../../runtime/runtime-client-target'
import { getEnvironmentSshStateGeneration } from '../slices/runtime-environment-ssh'
import { getRuntimeEnvironmentConnectionGeneration } from '../slices/runtime-status'
import { isHostCatalogFenceCurrent, type HostCatalogFence } from '../host-catalog-fencing'
import { fetchRepoCatalogForTarget } from './repo-catalog-merge'

export async function loadRepoCatalog(
  target: RuntimeClientTarget,
  fence: HostCatalogFence,
  set: Parameters<StateCreator<AppState>>[0],
  get: () => AppState
) {
  const hostId = getRuntimeTargetHostId(target)
  const connectionGeneration =
    target.kind === 'environment'
      ? getRuntimeEnvironmentConnectionGeneration(target.environmentId)
      : null
  const sshGeneration =
    target.kind === 'environment' ? getEnvironmentSshStateGeneration(target.environmentId) : null
  const updateStatus = (status: AppState['repoCatalogStatusByHost'][string]) => {
    if (isHostCatalogFenceCurrent(get, fence)) {
      set((state) => ({
        repoCatalogStatusByHost: { ...state.repoCatalogStatusByHost, [hostId]: status }
      }))
    }
  }
  updateStatus('loading')
  try {
    const catalog = await fetchRepoCatalogForTarget(target)
    if (
      target.kind === 'environment' &&
      (getRuntimeEnvironmentConnectionGeneration(target.environmentId) !== connectionGeneration ||
        getEnvironmentSshStateGeneration(target.environmentId) !== sshGeneration)
    ) {
      throw new Error('Project catalog belongs to a previous host connection')
    }
    updateStatus('ready')
    return catalog
  } catch (error) {
    updateStatus('unavailable')
    throw error
  }
}
