// Recovery releases a lease only after current host evidence proves its owner gone.

import {
  isProvenAliveProbe,
  isProvenDeadProbe,
  type AgentSessionOwnerProbe
} from '../../../shared/agent-session-lease-adjudication'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import { agentSessionExecutionHostProbeMatchesRecord } from '../../../shared/agent-session-execution-host-proof'
import { PROVIDER_SUPERVISOR_MAX_STOP_MS } from '../../provider-process/provider-process-supervisor'
import type { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'

export type StructuredSessionRecoveryStopSignal = 'SIGTERM' | 'SIGKILL'

export type StructuredSessionRecoveryResolutionDeps = {
  store: AgentSessionRecordStore
  probeRecord: (record: AgentSessionRecord) => Promise<AgentSessionOwnerProbe>
  now: () => number
  stopOwnerProcess?: (pid: number, signal: StructuredSessionRecoveryStopSignal) => void
  stopExecutionOwner?: (record: AgentSessionRecord) => Promise<AgentSessionOwnerProbe | null>
  delay?: (ms: number) => Promise<void>
  platform?: NodeJS.Platform
}

const STOP_PROBE_INTERVAL_MS = 250
// POSIX only: Windows never signals a recorded owner. The owner is its provider supervisor, which
// exits only after its provider group. A SIGKILL that lands first leaves the group running, so
// SIGTERM outlasts its stop.
const STOP_PROBES: Record<StructuredSessionRecoveryStopSignal, number> = {
  SIGTERM: Math.ceil(PROVIDER_SUPERVISOR_MAX_STOP_MS / STOP_PROBE_INTERVAL_MS) + 1,
  SIGKILL: 4
}

const UNRESOLVED_REFUSALS: ReadonlySet<string> = new Set([
  'agent_session_ownership_unknown',
  'agent_session_checkpoint_stale',
  'execution_owner_reconciling',
  'agent_session_identity_required'
])

export async function resolveStructuredSessionRecovery(
  deps: StructuredSessionRecoveryResolutionDeps,
  sessionId: string
): Promise<'resolved' | 'unresolved' | 'not-applicable'> {
  const record = deps.store.getRecord(sessionId)
  if (record?.provider === 'managed-pi' || record?.lease.handoffStage !== 'recovering') {
    return 'not-applicable'
  }
  let probe = await deps.probeRecord(record)
  if (
    Object.hasOwn(record, 'taskSource') ||
    deps.store.tasks.hasSessionBinding(record.sessionId) ||
    probe.outcome.startsWith('execution-host-')
  ) {
    return resolveExecutionHostRecovery(deps, record, probe)
  }
  const owner = record.lease.ownerProcess
  if (owner && record.lease.claimStatus === 'conflicted' && !isProvenDeadProbe(probe)) {
    // A conflicting claimant may still execute independently; require proof of its exit.
    return 'unresolved'
  }
  if (owner && isProvenAliveProbe(probe)) {
    if (owner.hostId !== deps.store.hostId) {
      return 'unresolved'
    }
    if ((deps.platform ?? process.platform) !== 'win32') {
      probe = await stopOwnerAndReprobe(deps, record, owner.pid)
    }
  }
  try {
    await deps.store.evictProvenDeadOwner({
      sessionId,
      expectedFence: record.lease.runtimeFence,
      probe,
      now: deps.now()
    })
    return 'resolved'
  } catch (error) {
    const code = error instanceof Error ? error.message : String(error)
    if (UNRESOLVED_REFUSALS.has(code)) {
      // The record moved under this resolution; the next attempt re-asks against what it is now.
      return 'unresolved'
    }
    throw error
  }
}

async function resolveExecutionHostRecovery(
  deps: StructuredSessionRecoveryResolutionDeps,
  record: AgentSessionRecord,
  initial: AgentSessionOwnerProbe
): Promise<'resolved' | 'unresolved'> {
  let probe = initial
  if (probe.outcome !== 'execution-host-exited') {
    if (record.lease.claimStatus === 'conflicted') {
      return 'unresolved'
    }
    probe = (await deps.stopExecutionOwner?.(record)) ?? { outcome: 'execution-host-unverifiable' }
  }
  if (
    probe.outcome !== 'execution-host-exited' ||
    !agentSessionExecutionHostProbeMatchesRecord(probe, record)
  ) {
    return 'unresolved'
  }
  return commitStructuredSessionExecutionHostExit(deps, record, probe)
}

export async function commitStructuredSessionExecutionHostExit(
  deps: Pick<StructuredSessionRecoveryResolutionDeps, 'store' | 'now'>,
  record: AgentSessionRecord,
  probe: AgentSessionOwnerProbe
): Promise<'resolved' | 'unresolved'> {
  if (
    probe.outcome !== 'execution-host-exited' ||
    !agentSessionExecutionHostProbeMatchesRecord(probe, record)
  ) {
    return 'unresolved'
  }
  try {
    if (record.lease.unreconciled) {
      const reconciled = await deps.store.reconcileOnRestart({
        owns: (current) =>
          current.sessionId === record.sessionId &&
          current.lease.runtimeFence === record.lease.runtimeFence,
        probe: async () => probe,
        now: deps.now()
      })
      const next = reconciled.get(record.sessionId)
      return next &&
        !next.lease.unreconciled &&
        next.lease.claimStatus === 'released' &&
        next.lease.deathEvidence?.kind === 'execution-host-exit-observed'
        ? 'resolved'
        : 'unresolved'
    }
    await deps.store.evictProvenDeadOwner({
      sessionId: record.sessionId,
      expectedFence: record.lease.runtimeFence,
      probe,
      now: deps.now()
    })
    return 'resolved'
  } catch (error) {
    if (error instanceof Error && UNRESOLVED_REFUSALS.has(error.message)) {
      return 'unresolved'
    }
    throw error
  }
}

async function stopOwnerAndReprobe(
  deps: StructuredSessionRecoveryResolutionDeps,
  record: AgentSessionRecord,
  pid: number
): Promise<AgentSessionOwnerProbe> {
  const stop = deps.stopOwnerProcess ?? defaultStopOwnerProcess
  const delay = deps.delay ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  let probe: AgentSessionOwnerProbe = { outcome: 'indeterminate', reason: 'owner stop requested' }
  for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
    stop(pid, signal)
    for (let attempt = 0; attempt < STOP_PROBES[signal]; attempt += 1) {
      probe = await deps.probeRecord(record)
      if (isProvenDeadProbe(probe)) {
        return probe
      }
      await delay(STOP_PROBE_INTERVAL_MS)
    }
  }
  return probe
}

function defaultStopOwnerProcess(pid: number, signal: StructuredSessionRecoveryStopSignal): void {
  try {
    process.kill(pid, signal)
  } catch {
    // Already gone or not ours to signal; the next probe supplies the actual proof.
  }
}
