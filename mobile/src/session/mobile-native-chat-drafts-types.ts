import type { Dispatch, SetStateAction } from 'react'
import type { MobileNativeChatLaunchDraftSeed } from './use-mobile-native-chat-launch-draft-seed'
import type {
  MobileNativeChatPendingMessage,
  MobileNativeChatSendOrigin
} from './mobile-native-chat-pending-echo'

export type MobileNativeChatDraftsState = {
  composerText: string
  setComposerText: Dispatch<SetStateAction<string>>
  appendComposerText: (text: string) => boolean
  getComposerEditGeneration: () => number
  pending: MobileNativeChatPendingMessage[]
  imagePreviewsByMessageId: Record<string, string[]>
  captureSendOrigin: (text: string, images?: readonly string[]) => MobileNativeChatSendOrigin | null
  readSeededLaunchDraft: () => string | null
  readSeededLaunchDraftSeed: () => MobileNativeChatLaunchDraftSeed | null
  clearDraftForSend: (origin: MobileNativeChatSendOrigin, text: string) => void
  restoreRejectedDraft: (origin: MobileNativeChatSendOrigin, text: string) => void
  acceptSend: (origin: MobileNativeChatSendOrigin, text: string, images?: string[]) => void
  holdUnconfirmedSend: (
    origin: MobileNativeChatSendOrigin,
    text: string,
    onUnconfirmed: () => void
  ) => void
}
