import type { WebSocket } from 'ws'
import { encrypt, encryptBytes } from './e2ee-crypto'
import {
  isMobileE2EETextPayloadWithinLimit,
  isMobileE2EEBinaryPayloadWithinLimit
} from './mobile-e2ee-outbound-admission'
import type { MobileE2EEDesktopOutboundOwner } from './mobile-e2ee-desktop-outbound-owner'
import type { OutboundBudgetEmitter } from './e2ee-channel-budget-close'

export function dispatchLegacyE2EEText(
  plaintext: string,
  options: {
    ws: WebSocket
    getKey: () => Uint8Array | null
    outbound: MobileE2EEDesktopOutboundOwner
    close: (reason: OutboundBudgetEmitter) => void
    handler:
      | ((
          plaintext: string,
          reply: (response: string) => void,
          binaryReply: (response: Uint8Array<ArrayBufferLike>) => boolean | void
        ) => void)
      | null
  }
): void {
  // Why: streaming emits can outlive destroy(), so late replies must not encrypt with a cleared key.
  const encryptedReply = (response: string) => {
    const key = options.getKey()
    if (!key || options.ws.readyState !== options.ws.OPEN) {
      return
    }
    if (!isMobileE2EETextPayloadWithinLimit(response)) {
      options.close('size')
      return
    }
    options.outbound.enqueueLegacyText(
      encrypt(response, key),
      () => Boolean(options.getKey()),
      () => options.close('queue')
    )
  }
  const encryptedBinaryReply = (response: Uint8Array<ArrayBufferLike>): boolean => {
    const key = options.getKey()
    if (!key || options.ws.readyState !== options.ws.OPEN) {
      return false
    }
    if (!isMobileE2EEBinaryPayloadWithinLimit(response)) {
      options.close('size')
      return false
    }
    if (!options.outbound.canSend(response.byteLength + 40)) {
      return false
    }
    options.ws.send(Buffer.from(encryptBytes(response, key)), { binary: true })
    return true
  }
  options.handler?.(plaintext, encryptedReply, encryptedBinaryReply)
}
