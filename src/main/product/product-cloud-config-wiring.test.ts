import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const MAIN_ROOT = path.resolve(import.meta.dirname, '..')
const GENERIC_CONFIG_PATH = path.join(MAIN_ROOT, 'orca-profiles', 'profile-cloud-auth-config.ts')
const GENERIC_ARTIFACT_CONFIG_PATH = path.join(MAIN_ROOT, 'artifacts', 'artifact-cloud-config.ts')
const PRODUCT_ADAPTER_PATH = path.join(MAIN_ROOT, 'product', 'product-cloud-config.ts')
const ARTIFACT_PRODUCT_ADAPTER_PATH = path.join(
  MAIN_ROOT,
  'product',
  'product-artifact-cloud-config.ts'
)

function collectRuntimeTypeScriptFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectRuntimeTypeScriptFiles(entryPath))
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(entryPath)
    }
  }
  return files
}

describe('product cloud config wiring', () => {
  it('keeps Orca production defaults out of the generic parser', () => {
    const genericSource = readFileSync(GENERIC_CONFIG_PATH, 'utf8')
    expect(genericSource).not.toContain('onorca.dev')
    expect(genericSource).not.toContain('ORCA_PRODUCT_DEFAULTS')

    const genericArtifactSource = readFileSync(GENERIC_ARTIFACT_CONFIG_PATH, 'utf8')
    expect(genericArtifactSource).not.toContain('share.onorca.dev')
  })

  it('prevents runtime modules from calling the generic Orca defaults directly', () => {
    const violations = collectRuntimeTypeScriptFiles(MAIN_ROOT)
      .filter((filePath) => filePath !== GENERIC_CONFIG_PATH && filePath !== PRODUCT_ADAPTER_PATH)
      .filter((filePath) => readFileSync(filePath, 'utf8').includes('getOrcaCloudAuthConfig('))
      .map((filePath) => path.relative(MAIN_ROOT, filePath).replaceAll('\\', '/'))

    expect(violations).toEqual([])
  })

  it('routes every cloud service entry point through the product adapter', () => {
    const expectedConsumers = [
      'artifacts/artifact-cloud-service.ts',
      'index.ts',
      'orca-profiles/profile-cloud-auth-status.ts',
      'orca-profiles/profile-cloud-capability-refresh.ts',
      'orca-profiles/profile-cloud-org-members-service.ts',
      'orca-profiles/profile-cloud-service.ts'
    ]

    for (const relativePath of expectedConsumers) {
      const source = readFileSync(path.join(MAIN_ROOT, relativePath), 'utf8')
      expect(source, relativePath).toContain('getProductCloudAuthConfig')
    }
  })

  it('routes artifact endpoints through the product adapter', () => {
    const serviceSource = readFileSync(
      path.join(MAIN_ROOT, 'artifacts', 'artifact-cloud-service.ts'),
      'utf8'
    )
    const adapterSource = readFileSync(ARTIFACT_PRODUCT_ADAPTER_PATH, 'utf8')

    expect(serviceSource).toContain('getProductArtifactCloudConfig')
    expect(serviceSource).not.toContain('resolveArtifactCloudApiUrl')
    expect(adapterSource).toContain('getProductExternalServiceEndpoints().artifacts')
  })

  it('prevents runtime modules from using the upstream artifact resolver directly', () => {
    const violations = collectRuntimeTypeScriptFiles(MAIN_ROOT)
      .filter((filePath) => filePath !== GENERIC_ARTIFACT_CONFIG_PATH)
      .filter((filePath) => readFileSync(filePath, 'utf8').includes('resolveArtifactCloudApiUrl('))
      .map((filePath) => path.relative(MAIN_ROOT, filePath).replaceAll('\\', '/'))

    expect(violations).toEqual([])
  })
})
