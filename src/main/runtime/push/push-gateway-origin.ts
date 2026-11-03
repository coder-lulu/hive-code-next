import { cleanCloudServiceOrigin } from '../../../shared/cloud-service-url'

/** Host-key push has no approved packaged gateway; Hive account push owns production delivery. */
export function resolvePushGatewayOrigin(env: NodeJS.ProcessEnv, packaged: boolean): string | null {
  return packaged ? null : cleanCloudServiceOrigin(env.ORCA_PUSH_GATEWAY_URL, true)
}
