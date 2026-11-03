import { getProductExternalServiceEndpoints } from '../product/product-external-service-endpoints'

type ProductDiagnosticsEndpoint = { diagnostics: string | null }

export function resolveDiagnosticBuildTokenEndpoint(
  config: ProductDiagnosticsEndpoint = getProductExternalServiceEndpoints()
): string | null {
  const endpoint = config.diagnostics
  if (!endpoint || !endpoint.trim()) return null
  try {
    const parsed = new URL(endpoint.trim())
    return parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash
      ? parsed.toString()
      : null
  } catch {
    return null
  }
}

export function resolveDiagnosticBuildIdentity(): 'stable' | 'rc' | null {
  const ident =
    typeof ORCA_BUILD_IDENTITY !== 'undefined'
      ? ORCA_BUILD_IDENTITY
      : ((globalThis as { ORCA_BUILD_IDENTITY?: 'stable' | 'rc' | null }).ORCA_BUILD_IDENTITY ??
        null)
  return ident === 'stable' || ident === 'rc' ? ident : null
}

export function resolveDiagnosticTokenEndpoint(
  config: ProductDiagnosticsEndpoint = getProductExternalServiceEndpoints()
): string | null {
  return resolveDiagnosticBuildTokenEndpoint(config)
}

export function resolveDiagnosticOrcaChannel(): 'stable' | 'rc' | 'dev' {
  const ident = resolveDiagnosticBuildIdentity()
  if (ident === 'stable' || ident === 'rc') {
    return ident
  }
  return 'dev'
}
