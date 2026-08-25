import type { WebSocket } from 'ws'

// Why: force-terminate soon after the 1013 close since a half-open phone may never ack and would hold the descriptor past the WS cap.
export function rejectWebSocketOverCapacity(ws: WebSocket): void {
  ws.on('error', () => {})
  ws.close(1013, 'Maximum connections reached')
  const terminateTimer = setTimeout(() => ws.terminate(), 1_000)
  terminateTimer.unref?.()
  ws.once('close', () => clearTimeout(terminateTimer))
}
