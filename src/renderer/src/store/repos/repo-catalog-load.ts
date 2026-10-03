import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type { RuntimeClientTarget } from '../../runtime/runtime-rpc-client'
import { getRuntimeTargetHostId } from '../runtime-target-host'
import { getEnvironmentSshStateGeneration } from '../slices/runtime-environment-ssh'
import { getRuntimeEnvironmentConnectionGeneration } from '../slices/runtime-status'
import { isLatestRepoCatalogGeneration } from './repo-catalog-fencing'
import { fetchRepoCatalogForTarget } from './repo-catalog-merge'

export async function loadRepoCatalog(
  target: RuntimeClientTarget,
  generation: number,
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
    if (isLatestRepoCatalogGeneration(get, hostId, generation)) {
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
