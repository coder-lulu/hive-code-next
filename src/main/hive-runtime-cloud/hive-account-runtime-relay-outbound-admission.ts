import { MOBILE_E2EE_V2_FRAME_OVERHEAD_BYTES } from '../../shared/mobile-e2ee-v2-framing'
import { REMOTE_RUNTIME_MAX_OUTBOUND_BINARY_FRAME_BYTES } from '../../shared/remote-runtime-memory-limits'
import type { WsOutboundBackpressureQueueOptions } from '../../shared/ws-outbound-backpressure-queue'
import {
  createMobileE2EEOutboundMemoryBudget,
  type MobileE2EEOutboundMemoryBudget
} from '../runtime/rpc/mobile-e2ee-outbound-memory-budget'
import { relayConnectionError } from './hive-account-runtime-relay-protocol'

export type HiveAccountRuntimeRelayOutboundFrame =
  | Readonly<{ kind: 'text'; plaintext: string }>
  | Readonly<{ kind: 'binary'; plaintext: Uint8Array<ArrayBufferLike> }>

const sharedOutboundMemoryBudget = createMobileE2EEOutboundMemoryBudget()

export function reserveHiveAccountRuntimeRelayOutbound(options: {
  readBufferedAmount: () => number
  terminateSocket: () => void
  memoryBudget?: MobileE2EEOutboundMemoryBudget
}): {
  release: () => void
  queueOptions: Pick<
    WsOutboundBackpressureQueueOptions<HiveAccountRuntimeRelayOutboundFrame>,
    'byteLengthOf' | 'canSend' | 'claimQueuedBytes' | 'maxFrameBytes'
  >
} {
  const memoryBudget = options.memoryBudget ?? sharedOutboundMemoryBudget
  const socketMemory = memoryBudget.registerBufferedAmount(options.readBufferedAmount)
  if (!socketMemory) {
    try {
      options.terminateSocket()
    } catch {
      // No memory reservation was retained, so only the socket needs best-effort cleanup.
    }
    throw relayConnectionError('Cloud Runtime outbound memory admission failed.')
  }
  return {
    release: socketMemory.release,
    queueOptions: {
      byteLengthOf: encryptedFrameBytes,
      canSend: (bytes) => socketMemory.canSend(bytes),
      claimQueuedBytes: (bytes) => memoryBudget.claimQueuedBytes(bytes),
      maxFrameBytes:
        REMOTE_RUNTIME_MAX_OUTBOUND_BINARY_FRAME_BYTES + MOBILE_E2EE_V2_FRAME_OVERHEAD_BYTES
    }
  }
}

function encryptedFrameBytes(frame: HiveAccountRuntimeRelayOutboundFrame): number {
  const encryptedBytes =
    (frame.kind === 'text' ? Buffer.byteLength(frame.plaintext) : frame.plaintext.byteLength) +
    MOBILE_E2EE_V2_FRAME_OVERHEAD_BYTES
  return frame.kind === 'text' ? Math.ceil(encryptedBytes / 3) * 4 : encryptedBytes
}
