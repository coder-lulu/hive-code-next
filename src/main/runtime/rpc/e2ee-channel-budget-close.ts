import type { EventProps } from '../../../shared/telemetry-events'
import { track } from '../../telemetry/client'

export type OutboundBudgetEmitter = EventProps<'remote_outbound_budget_close'>['emitter']

export function reportE2EEOutboundBudgetClose(
  emitter: OutboundBudgetEmitter,
  close: (code: number, reason: string) => void
): void {
  try {
    track('remote_outbound_budget_close', { emitter })
  } catch {
    // Telemetry is best-effort; closing the unsafe socket remains authoritative.
  }
  close(1013, 'Outbound reply buffer overflow')
}
