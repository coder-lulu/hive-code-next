import { webRuntimeCredentialFor } from './web-runtime-credentials'
import { webRuntimeState } from './web-runtime-state'
import { isSameWebRuntimePairing } from './web-runtime-session-presentation'
import {
  clearStoredWebRuntimeEnvironment,
  replaceStoredTokenWithDeviceKey,
  type StoredWebRuntimeEnvironment
} from '../web-runtime-environment'
export function credentialFor(environment: StoredWebRuntimeEnvironment) {
  return webRuntimeCredentialFor(environment, {
    forgetStoredToken: (deviceId) => {
      if (
        isSameWebRuntimePairing(webRuntimeState.activeEnvironment, environment) &&
        webRuntimeState.activeEnvironment
      ) {
        webRuntimeState.activeEnvironment = replaceStoredTokenWithDeviceKey(
          webRuntimeState.activeEnvironment,
          deviceId
        )
      }
    },
    // Why not close clients here: the transport is mid-verdict and moves itself to auth-failed.
    forgetPairing: () => {
      if (isSameWebRuntimePairing(webRuntimeState.activeEnvironment, environment)) {
        clearStoredWebRuntimeEnvironment()
        webRuntimeState.activeEnvironment = null
      }
    }
  })
}
