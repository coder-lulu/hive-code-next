import type { CurrentHiveRuntimeCloudLeaseContext } from './hive-runtime-cloud-lease-context'
import {
  sendHiveRuntimeCloudHeartbeat,
  type PendingHeartbeat,
  type HeartbeatOptions
} from './hive-runtime-cloud-heartbeat'
import type { HiveRuntimeCloudReport } from './hive-runtime-cloud-proof'
import type { RuntimeHeartbeat } from './hive-runtime-cloud-response'
import { hiveRuntimeCloudHeartbeatDelay } from './hive-runtime-cloud-presence-scheduling'
import { withHiveRuntimeRelayHeartbeatReport } from './hive-runtime-cloud-report'
import type {
  HiveRuntimeRelayHeartbeatContributor,
  HiveRuntimeRelayHeartbeatResponseControl
} from './relay-host/hive-runtime-relay-heartbeat-types'

export class HiveRuntimeCloudPresenceRelay {
  private heartbeatRequested = false
  private flushing = false
  private pendingHeartbeat: PendingHeartbeat | null = null
  private contributor: HiveRuntimeRelayHeartbeatContributor | null = null
  private pending: {
    contributor: HiveRuntimeRelayHeartbeatContributor
    context: CurrentHiveRuntimeCloudLeaseContext
  } | null = null

  constructor(private readonly startHeartbeat: () => boolean) {}

  requestHeartbeat(): void {
    this.heartbeatRequested = true
    this.flush()
  }
  resetRequest(): void {
    this.heartbeatRequested = false
  }
  flush(): void {
    if (!this.heartbeatRequested || this.flushing) {
      return
    }
    this.heartbeatRequested = false
    this.flushing = true
    try {
      if (!this.startHeartbeat()) {
        this.heartbeatRequested = true
      }
    } finally {
      this.flushing = false
    }
  }

  async send(
    options: Omit<HeartbeatOptions, 'pending' | 'onPrepared' | 'onAccepted'> & {
      context: CurrentHiveRuntimeCloudLeaseContext | null
    }
  ): Promise<{ nextHeartbeatSeq: number; heartbeatDelay: number }> {
    let sessionAuthorityUntil: number | null = null
    const next = await sendHiveRuntimeCloudHeartbeat({
      ...options,
      report: this.prepare(options.report, options.context, this.pendingHeartbeat !== null),
      pending: this.pendingHeartbeat,
      onPrepared: (pending) => {
        this.pendingHeartbeat = pending
      },
      onAccepted: (response, sent) => {
        if (sent.report.relayControl && response.responseVersion === 'runtime-session-control/v1') {
          sessionAuthorityUntil = response.sessionAuthorityUntil ?? null
        }
        this.accept(response, sent)
      }
    })
    this.clearPending()
    return {
      nextHeartbeatSeq: next,
      heartbeatDelay: hiveRuntimeCloudHeartbeatDelay(sessionAuthorityUntil, options.now())
    }
  }

  install(contributor: HiveRuntimeRelayHeartbeatContributor | null): void {
    this.contributor = contributor
    this.requestHeartbeat()
  }
  clearPending(): void {
    this.pending = null
    this.pendingHeartbeat = null
  }
  prepare(
    report: HiveRuntimeCloudReport,
    context: CurrentHiveRuntimeCloudLeaseContext | null,
    retry: boolean
  ): HiveRuntimeCloudReport {
    if (retry) {
      return report
    }
    this.pending = null
    if (!context || !this.contributor) {
      return report
    }
    const snapshot = this.contributor.snapshot(context)
    if (!snapshot) {
      return report
    }
    this.pending = { contributor: this.contributor, context }
    return withHiveRuntimeRelayHeartbeatReport(report, snapshot)
  }
  accept(response: RuntimeHeartbeat, sent: PendingHeartbeat): void {
    const pending = this.pending
    if (!sent.report.relayControl || !pending || pending.contributor !== this.contributor) {
      return
    }
    pending.contributor.accept(
      pending.context,
      response as RuntimeHeartbeat & HiveRuntimeRelayHeartbeatResponseControl,
      structuredClone(sent.report.relayControl)
    )
  }
}
