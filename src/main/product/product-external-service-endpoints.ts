import { hivecodeProductConfig } from '../../shared/generated/product-config'

export type ProductExternalServiceEndpoints = {
  artifacts: string | null
  feedback: string | null
  pluginKillList: string | null
  pluginMarketplace: string | null
  changelog: string | null
  nudge: string | null
  telemetry: string | null
  diagnostics: string | null
}

type ProductEndpointConfig = {
  endpoints: ProductExternalServiceEndpoints
  services?: {
    oss: {
      enabled: boolean
      endpoint: string | null
    }
  }
}

type ProductStarRepositoryConfig = {
  desktop: {
    starRepository: string | null
  }
}

export function getProductExternalServiceEndpoints(
  config: ProductEndpointConfig = hivecodeProductConfig
): ProductExternalServiceEndpoints {
  const oss = config.services?.oss
  return {
    // A declared service group is authoritative, including an explicit
    // disabled state. Legacy endpoint fallback is only for pre-service
    // manifests that do not declare the group yet.
    artifacts: oss ? (oss.enabled ? oss.endpoint : null) : config.endpoints.artifacts,
    feedback: config.endpoints.feedback,
    pluginKillList: config.endpoints.pluginKillList,
    pluginMarketplace: config.endpoints.pluginMarketplace,
    changelog: config.endpoints.changelog,
    nudge: config.endpoints.nudge,
    telemetry: config.endpoints.telemetry,
    diagnostics: config.endpoints.diagnostics
  }
}

export function getProductStarRepository(
  config: ProductStarRepositoryConfig = hivecodeProductConfig
): string | null {
  return config.desktop.starRepository
}
