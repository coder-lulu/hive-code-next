import type {
  RuntimeHostStatusSnapshot,
  RuntimeHostStatusResponse
} from '../../../../shared/runtime-host-status'
import type { StoredWebRuntimeEnvironment } from '../web-runtime-environment'
import type { WebRuntimeDisplayProjection } from './web-runtime-display-projection'
export function createWebRuntimeStatusOptions(
  environment: StoredWebRuntimeEnvironment,
  displayProjection: WebRuntimeDisplayProjection,
  statusListeners: Set<(snapshot: RuntimeHostStatusSnapshot) => void>,
  updateEnvironmentFromResponse: (
    environment: StoredWebRuntimeEnvironment,
    response: RuntimeHostStatusResponse
  ) => void
) {
  const generation = displayProjection.generation
  return {
    environmentId: environment.id,
    pairingRevision: environment.pairingRevision ?? environment.createdAt,
    publish: (snapshot: RuntimeHostStatusSnapshot) => {
      if (generation !== displayProjection.generation) {
        return
      }
      for (const listener of statusListeners) {
        listener(snapshot)
      }
    },
    verified: (response: RuntimeHostStatusResponse) => {
      if (generation === displayProjection.generation) {
        updateEnvironmentFromResponse(environment, response)
      }
    }
  }
}
