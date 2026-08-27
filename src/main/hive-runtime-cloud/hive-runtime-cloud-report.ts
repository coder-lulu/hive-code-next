import type { RuntimeStatus } from '../../shared/runtime-types'
import type { HiveRuntimeCloudWebLaunchConfig } from './hive-runtime-cloud-config'
import type { HiveRuntimeCloudReport } from './hive-runtime-cloud-proof'

const WEB_ENDPOINT_TTL_MS = 75_000

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
  runtimeVersion: string,
  webLaunch?: HiveRuntimeCloudWebLaunchConfig,
  now: () => number = Date.now
): HiveRuntimeCloudReport {
  const status = runtime.getStatus()
  return {
    runtimeVersion,
    runtimeProtocolVersion: 3,
    capabilities: webLaunch
      ? ['pairing-v3', 'runtime-health-v1', 'connection-ticket-v1', 'web-launch-grant-v1']
      : ['pairing-v3', 'runtime-health-v1'],
    ...readiness(status),
    startedAt: new Date(runtime.getStartedAt()).toISOString(),
    connectionCapabilities: ['orca-direct'],
    ...(webLaunch
      ? {
          webHttpsOrigin: webLaunch.publicOrigin,
          webClientPath: webLaunch.webClientPath,
          websocketPath: webLaunch.websocketPath,
          webEndpointExpiresAt: new Date(now() + WEB_ENDPOINT_TTL_MS).toISOString()
        }
      : {})
  }
}
