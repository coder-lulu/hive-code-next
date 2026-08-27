// Build-time diagnostic upload routing. Kept outside ipc/diagnostics.ts so
// crash reporting can attach logs through the same pinned endpoint rules.

import { getProductExternalServiceEndpoints } from '../product/product-external-service-endpoints'

type ProductDiagnosticsEndpoint = {
  diagnostics: string | null
}

function normalizeProductDiagnosticsEndpoint(endpoint: string | null): string | null {
  if (!endpoint || endpoint.trim().length === 0) {
    return null
  }
  let parsed: URL
  try {
    parsed = new URL(endpoint.trim())
  } catch {
    return null
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    return null
  }
  return parsed.toString()
}

export function resolveDiagnosticBuildTokenEndpoint(
  config: ProductDiagnosticsEndpoint = getProductExternalServiceEndpoints()
): string | null {
  return normalizeProductDiagnosticsEndpoint(config.diagnostics)
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
