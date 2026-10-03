import type { E2EEChannel } from './e2ee-channel'
import type {
  E2EEAccountSessionResolver,
  E2EEAuthenticatedAccountSession
} from './e2ee-channel-account-authentication'
import type {
  E2EEAuthenticatedDevice,
  E2EEAuthenticatedCloudSession,
  E2EECloudManagedSessionResolver
} from './e2ee-channel-authentication'
import type { DesktopMobileE2EEV2Context } from './mobile-e2ee-v2-desktop-session'
import type { MobileE2EEOutboundMemoryBudget } from './mobile-e2ee-outbound-memory-budget'
export type E2EEChannelOptions = {
  serverSecretKey: Uint8Array
  resolveAuthenticatedDevice: (token: string) => E2EEAuthenticatedDevice | null
  onReady: (channel: E2EEChannel, device: E2EEAuthenticatedDevice) => void
  resolveAccountSession?: E2EEAccountSessionResolver
  onAccountReady?: (channel: E2EEChannel, principal: E2EEAuthenticatedAccountSession) => void
  resolveCloudManagedSession?: E2EECloudManagedSessionResolver
  onCloudReady?: (channel: E2EEChannel, principal: E2EEAuthenticatedCloudSession) => void
  onError: (
    code: number,
    reason: string,
    principalKind?: 'paired_device' | 'cloud_managed_web_session' | 'account_runtime_session'
  ) => void
  transportContext?: DesktopMobileE2EEV2Context
  outboundMemoryBudget?: MobileE2EEOutboundMemoryBudget
}

export type E2EETextMessageHandler = (
  plaintext: string,
  encryptedReply: (response: string) => void,
  encryptedBinaryReply: (response: Uint8Array<ArrayBufferLike>) => boolean | void
) => void
