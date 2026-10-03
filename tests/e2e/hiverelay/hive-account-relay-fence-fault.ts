import type { OldControlCredential } from './hive-account-relay-fence-probe'

export class FenceFaultInjector {
  readonly suppressedCommands: Record<string, unknown>[] = []
  readonly suppressedStaleRefreshes: Record<string, unknown>[] = []
  private suppress = false
  private assignmentId: string | null = null
  private oldControlCredential: OldControlCredential | undefined
  private oldControlRefresh: Record<string, unknown> | undefined

  constructor(private readonly targetRuntimeId: string) {}

  start(assignmentId: string) {
    this.assignmentId = assignmentId
    this.suppress = true
  }

  stop() {
    this.suppress = false
  }

  get credential() {
    return this.oldControlCredential
  }

  async captureAssignment(runtimeId: string, path: string, response: Response) {
    if (
      runtimeId !== this.targetRuntimeId ||
      (path !== '/v1/assign' && !path.endsWith('/relay/control-leases/refresh'))
    ) {
      return
    }
    const value = (await response.clone().json()) as Record<string, unknown>
    if (this.assignmentId && value.assignmentId !== this.assignmentId) {
      return
    }
    this.oldControlCredential = {
      cellUrl: String(value.cellUrl),
      controlLease: String(value.controlLease),
      assignmentId: String(value.assignmentId),
      expiresAt: Number(value.controlLeaseExpiresAt)
    }
    this.oldControlRefresh = value
  }

  async hideStaleRefresh(
    runtimeId: string,
    path: string,
    response: Response,
    recordLifecycle?: (event: Record<string, unknown>) => void
  ) {
    if (
      !this.suppress ||
      runtimeId !== this.targetRuntimeId ||
      !path.endsWith('/relay/control-leases/refresh') ||
      response.status !== 409 ||
      !this.oldControlRefresh
    ) {
      return undefined
    }
    const failure = (await response.clone().json()) as Record<string, unknown>
    if (failure.code !== 'ASSIGNMENT_AUTHORITY_STALE') {
      return undefined
    }
    this.suppressedStaleRefreshes.push({
      assignmentId: this.assignmentId,
      status: response.status,
      code: failure.code,
      observedAt: Date.now()
    })
    recordLifecycle?.({
      event: 'stale-control-refresh-suppressed',
      runtimeId,
      path,
      actualStatus: response.status,
      observedAt: Date.now()
    })
    return new Response(JSON.stringify(this.oldControlRefresh), {
      status: 200,
      headers: { 'cache-control': 'no-store', 'content-type': 'application/json' }
    })
  }

  hideCommands(
    runtimeId: string,
    response: Response,
    heartbeat: Record<string, unknown>,
    recordLifecycle: (event: Record<string, unknown>) => void
  ) {
    if (
      !this.suppress ||
      runtimeId !== this.targetRuntimeId ||
      !Array.isArray(heartbeat.controlCommands) ||
      heartbeat.controlCommands.length === 0
    ) {
      return response
    }
    for (const value of heartbeat.controlCommands) {
      const command = value as Record<string, unknown>
      this.suppressedCommands.push({
        commandId: command.commandId,
        sequence: command.sequence,
        managedSessionId: command.managedSessionId,
        targetResourceVersion: command.targetResourceVersion,
        observedAt: Date.now()
      })
    }
    recordLifecycle({
      event: 'control-command-suppressed',
      runtimeId,
      count: heartbeat.controlCommands.length
    })
    return new Response(
      JSON.stringify({
        ...heartbeat,
        controlCommands: [],
        nextControlSequence: Number(heartbeat.ackedControlSequence) + 1
      }),
      { status: response.status, statusText: response.statusText, headers: response.headers }
    )
  }
}
