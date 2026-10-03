import type { RuntimeEnvironmentStatus } from './runtime-status'
import type { RuntimeHostStatusSnapshot } from '../../../../shared/runtime-host-status'
import type { RuntimeStatus } from '../../../../shared/runtime-types'
import { unwrapRuntimeRpcResult } from '@/runtime/runtime-rpc-client'
import { getRuntimeEnvironmentRevision } from '@/runtime/runtime-environment-revision'
import { extractRuntimeTransportDiagnostics } from '@/runtime/runtime-status-probe-diagnostics'

const requestSequenceByEnvironmentId = new Map<string, number>()

function beginRequest(environmentId: string): number {
  const sequence = (requestSequenceByEnvironmentId.get(environmentId) ?? 0) + 1
  requestSequenceByEnvironmentId.set(environmentId, sequence)
  return sequence
}

function isCurrentRequest(environmentId: string, sequence: number): boolean {
  return requestSequenceByEnvironmentId.get(environmentId) === sequence
}

export async function refreshRuntimeEnvironmentStatus(
  environmentId: string,
  timeoutMs: number,
  publish: (status: RuntimeEnvironmentStatus) => void,
  // Why separate: a snapshot carries the host's own verdict, so it goes through
  // applyRuntimeHostStatusSnapshot — the single place that decides when status is nulled.
  applySnapshot: (snapshot: RuntimeHostStatusSnapshot) => void
): Promise<boolean> {
  const expectedEnvironmentRevision = getRuntimeEnvironmentRevision(environmentId)
  const requestSequence = beginRequest(environmentId)
  try {
    const response = await window.api.runtimeEnvironments.getStatus({
      selector: environmentId,
      timeoutMs
    })
    if (window.api.runtimeEnvironments.getStatusSnapshots) {
      try {
        const snapshots = await window.api.runtimeEnvironments.getStatusSnapshots()
        const snapshot = snapshots.find((entry) => entry.environmentId === environmentId)
        if (
          snapshot &&
          isCurrentRequest(environmentId, requestSequence) &&
          getRuntimeEnvironmentRevision(environmentId) === expectedEnvironmentRevision
        ) {
          applySnapshot(snapshot)
        }
      } catch (error) {
        console.error('Failed to read runtime host status snapshot:', error)
      }
    }
    const status = unwrapRuntimeRpcResult<RuntimeStatus>(response)
    if (
      !isCurrentRequest(environmentId, requestSequence) ||
      getRuntimeEnvironmentRevision(environmentId) !== expectedEnvironmentRevision
    ) {
      return false
    }
    publish({ status, checkedAt: Date.now() })
    return true
  } catch (error: unknown) {
    if (
      !isCurrentRequest(environmentId, requestSequence) ||
      getRuntimeEnvironmentRevision(environmentId) !== expectedEnvironmentRevision
    ) {
      return false
    }
    const remoteControl = extractRuntimeTransportDiagnostics(error)
    publish({
      status: null,
      ...(remoteControl ? { remoteControl } : {}),
      checkedAt: Date.now()
    })
    return false
  }
}
