import { app } from 'electron'
import { validateArtifactCloudApiUrl } from '../artifacts/artifact-cloud-config'
import { getProductExternalServiceEndpoints } from './product-external-service-endpoints'

export type ProductArtifactCloudConfig =
  | { configured: true; apiUrl: string }
  | { configured: false; setupMessage: string }

function isPackaged(): boolean {
  try {
    return app?.isPackaged === true
  } catch {
    return false
  }
}

export function getProductArtifactCloudConfig(
  override?: string,
  env: NodeJS.ProcessEnv = process.env,
  packaged = isPackaged(),
  productEndpoint: string | null = getProductExternalServiceEndpoints().artifacts
): ProductArtifactCloudConfig {
  const candidate = packaged
    ? productEndpoint?.trim()
    : override?.trim() || env.ORCA_ARTIFACTS_API_URL?.trim() || productEndpoint?.trim()
  if (!candidate) {
    return {
      configured: false,
      setupMessage: 'Artifact sharing is not configured for this product.'
    }
  }
  return {
    configured: true,
    apiUrl: validateArtifactCloudApiUrl(candidate, packaged)
  }
}
