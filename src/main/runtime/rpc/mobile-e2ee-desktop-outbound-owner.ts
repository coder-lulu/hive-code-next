import type { WebSocket } from 'ws'
import type { WsOutboundBackpressureQueue } from '../../../shared/ws-outbound-backpressure-queue'
import {
  createDesktopMobileE2EEV2OutboundQueue,
  type DesktopMobileE2EEV2OutboundItem
} from './mobile-e2ee-v2-desktop-outbound'
import type { DesktopMobileE2EEV2Session } from './mobile-e2ee-v2-desktop-session'
import {
  createMobileE2EEOutboundMemoryBudget,
  type MobileE2EEOutboundMemoryBudget,
  type MobileE2EEOutboundSocketMemory
} from './mobile-e2ee-outbound-memory-budget'

export class MobileE2EEDesktopOutboundOwner {
  private readonly memoryBudget: MobileE2EEOutboundMemoryBudget
  private readonly socketMemory: MobileE2EEOutboundSocketMemory | null
  private v2Queue: WsOutboundBackpressureQueue<DesktopMobileE2EEV2OutboundItem> | null = null

  constructor(
    private readonly ws: WebSocket,
    memoryBudget: MobileE2EEOutboundMemoryBudget = createMobileE2EEOutboundMemoryBudget()
  ) {
    this.memoryBudget = memoryBudget
    this.socketMemory = memoryBudget.registerBufferedAmount(() => ws.bufferedAmount)
  }

  enqueueV2(
    item: DesktopMobileE2EEV2OutboundItem,
    session: DesktopMobileE2EEV2Session,
    onOverflow: () => void
  ): boolean {
    if (!this.socketMemory) {
      onOverflow()
      return false
    }
    this.v2Queue ??= createDesktopMobileE2EEV2OutboundQueue({
      ws: this.ws,
      session,
      memoryBudget: this.memoryBudget,
      socketMemory: this.socketMemory,
      onOverflow
    })
    return this.v2Queue.enqueue(item)
  }

  dispose(): void {
    this.v2Queue?.dispose()
    this.v2Queue = null
    this.socketMemory?.release()
  }
}
