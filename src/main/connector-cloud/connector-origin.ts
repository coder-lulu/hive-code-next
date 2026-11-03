import { cleanCloudServiceOrigin } from '../../shared/cloud-service-url'

export function resolveConnectorOrigin(env: NodeJS.ProcessEnv, packaged: boolean): string | null {
  return packaged ? null : cleanCloudServiceOrigin(env.ORCA_CONNECTOR_URL, true)
}
