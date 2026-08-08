import { hivecodeProductConfig } from '../../shared/generated/product-config'

export type ProductExternalServiceEndpoints = {
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
}

type ProductStarRepositoryConfig = {
  desktop: {
    starRepository: string | null
  }
}

export function getProductExternalServiceEndpoints(
  config: ProductEndpointConfig = hivecodeProductConfig
): ProductExternalServiceEndpoints {
  return {
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
