import { PermissionStatus, requireOptionalNativeModule } from 'expo-modules-core'

type ExpoTwoWayAudioNativeModule = {
  initialize: () => Promise<boolean>
  playPCMData: (audioData: Uint8Array) => void
  bypassVoiceProcessing: (bypass: boolean) => void
  toggleRecording: (value: boolean) => boolean
  isRecording: () => boolean
  tearDown: () => void
  restart: () => void
  getMicrophonePermissionsAsync: () => Promise<{
    status: PermissionStatus.DENIED
    granted: false
    canAskAgain: boolean
    expires: 'never'
  }>
  requestMicrophonePermissionsAsync: () => Promise<{
    status: PermissionStatus.DENIED
    granted: false
    canAskAgain: boolean
    expires: 'never'
  }>
  getMicrophoneModeIOS: () => undefined
  setMicrophoneModeIOS: () => undefined
  isPlaying: () => boolean
  stopPlayback: () => void
  pausePlayback: () => void
  resumePlayback: () => void
  addListener: <Event>(
    _eventName: string,
    _listener: (event: Event) => void
  ) => { remove: () => void }
}

// A stale or incomplete native build must not terminate the whole app when a
// session route mounts. Dictation remains unavailable until the next complete
// build, while terminal and chat functionality continue to work.
const unavailableNativeModule: ExpoTwoWayAudioNativeModule = {
  initialize: async () => false,
  playPCMData: () => undefined,
  bypassVoiceProcessing: () => undefined,
  toggleRecording: () => false,
  isRecording: () => false,
  tearDown: () => undefined,
  restart: () => undefined,
  getMicrophonePermissionsAsync: async () => ({
    status: PermissionStatus.DENIED,
    granted: false,
    canAskAgain: false,
    expires: 'never'
  }),
  requestMicrophonePermissionsAsync: async () => ({
    status: PermissionStatus.DENIED,
    granted: false,
    canAskAgain: false,
    expires: 'never'
  }),
  getMicrophoneModeIOS: () => undefined,
  setMicrophoneModeIOS: () => undefined,
  isPlaying: () => false,
  stopPlayback: () => undefined,
  pausePlayback: () => undefined,
  resumePlayback: () => undefined,
  addListener: () => ({ remove: () => undefined })
}

// It loads the native module object from the JSI or falls back to
// the bridge module (from NativeModulesProxy) if the remote debugger is on.
export default requireOptionalNativeModule<ExpoTwoWayAudioNativeModule>('ExpoTwoWayAudio') ??
  unavailableNativeModule
