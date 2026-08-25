import type { RuntimeStatus } from '../../shared/runtime-types'
import type { HiveRuntimeCloudReport } from './hive-runtime-cloud-proof'

type RuntimeReportSource = {
  getStartedAt: () => number
  getStatus: () => Pick<RuntimeStatus, 'graphStatus'>
}

function readiness(
  status: ReturnType<RuntimeReportSource['getStatus']>
): Pick<HiveRuntimeCloudReport, 'readiness' | 'readinessReasonCode'> {
  if (status.graphStatus === 'ready') {
    return { readiness: 'READY', readinessReasonCode: 'healthy' }
  }
  if (status.graphStatus === 'reloading') {
    return { readiness: 'RECOVERING', readinessReasonCode: 'recovery_in_progress' }
  }
  return { readiness: 'STARTING', readinessReasonCode: 'starting' }
}

export function createHiveRuntimeCloudReport(
  runtime: RuntimeReportSource,
  runtimeVersion: string
): HiveRuntimeCloudReport {
  const status = runtime.getStatus()
  return {
    runtimeVersion,
    runtimeProtocolVersion: 3,
    capabilities: ['pairing-v3', 'runtime-health-v1'],
    ...readiness(status),
    startedAt: new Date(runtime.getStartedAt()).toISOString(),
    connectionCapabilities: ['orca-direct']
  }
}
