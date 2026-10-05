import type { RuntimeStatus } from '../../shared/runtime-types'
import type { HiveRuntimeCloudWebLaunchConfig } from './hive-runtime-cloud-config'
import type { HiveRuntimeCloudReport } from './hive-runtime-cloud-proof'
import type { HiveRuntimeRelayHeartbeatSnapshot } from './relay-host/hive-runtime-relay-heartbeat-types'
import { isHiveRuntimeRelayHeartbeatControl } from './relay-host/hive-runtime-relay-heartbeat-validation'
import {
  getHiveRuntimeDeviceInfoSnapshot,
  type HiveRuntimeDeviceInfo
} from './hive-runtime-device-info'

const WEB_ENDPOINT_TTL_MS = 75_000

export function withHiveRuntimeRelayHeartbeatReport(
  report: HiveRuntimeCloudReport,
  snapshot: HiveRuntimeRelayHeartbeatSnapshot | null
): HiveRuntimeCloudReport {
  if (!snapshot) {
    return report
  }
  if (
    !isHiveRuntimeRelayHeartbeatControl(snapshot.relayControl) ||
    typeof snapshot.advertiseRelay !== 'boolean' ||
    (snapshot.advertiseRelay && !snapshot.relayControl.controlConnectionAcknowledged)
  ) {
    throw new Error('invalid_hive_runtime_relay_heartbeat_report')
  }
  const capabilities = [...new Set([...report.capabilities, 'runtime-session-control-v1' as const])]
  const connections: HiveRuntimeCloudReport['connectionCapabilities'][number][] =
    report.connectionCapabilities.filter(
      (item) => item !== 'hive-relay' && item !== 'ticket-connect-v2'
    )
  if (snapshot.advertiseRelay) {
    connections.push('hive-relay', 'ticket-connect-v2')
  }
  return {
    ...report,
    capabilities,
    connectionCapabilities: connections,
    relayControl: structuredClone(snapshot.relayControl)
  }
}

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
  now: () => number = Date.now,
  deviceInfo: HiveRuntimeDeviceInfo = getHiveRuntimeDeviceInfoSnapshot()
): HiveRuntimeCloudReport {
  const status = runtime.getStatus()
  return {
    runtimeVersion,
    runtimeProtocolVersion: 3,
    capabilities: webLaunch
      ? [
          'pairing-v3',
          'runtime-health-v1',
          'connection-ticket-v1',
          'web-launch-grant-v1',
          'web-session-display-metadata-v1'
        ]
      : ['pairing-v3', 'runtime-health-v1'],
    ...readiness(status),
    startedAt: new Date(runtime.getStartedAt()).toISOString(),
    connectionCapabilities: ['orca-direct'],
    ...deviceInfo,
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
