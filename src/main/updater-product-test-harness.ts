import { vi } from 'vitest'
import type { Mock } from 'vitest'

type ProductUpdaterSpy = Mock<(...args: unknown[]) => unknown>

export type ProductUpdateSource = {
  channel: 'stable' | 'beta' | 'rc'
  feedUrl: string
  github: {
    repo: string
    atomFeedUrl: string
    releasesDownloadBase: string
    releasesApiUrl: string
  } | null
  provider: 'github' | 'hivecloud'
}

export type ProductUpdaterModuleFactories = {
  productUpdatePolicy: () => { hasConfiguredProductUpdateChannel: () => boolean }
  productUpdateSource: () => {
    resolveProductUpdateSource: () => ProductUpdateSource | null
    resolveProductUpdateFeedUrl: (
      source: ProductUpdateSource,
      platform: string,
      arch: string
    ) => string | null
  }
  productUpdaterNetworkBoundary: () => { installProductUpdaterNetworkBoundary: ProductUpdaterSpy }
  productUpdaterSession: () => { fetchWithProductUpdaterSession: ProductUpdaterSpy }
  linuxRootPackageInstallPolicy: () => { requiresManualLinuxRootPackageInstall: () => boolean }
}

export type ProductUpdaterTestState = {
  productUpdatePolicy: { configured: boolean }
  productUpdateSourceState: { value: ProductUpdateSource | null }
  installProductUpdaterNetworkBoundaryMock: ProductUpdaterSpy
  fetchProductUpdateManifestMock: ProductUpdaterSpy
  linuxRootPackageInstallPolicy: { manual: boolean }
}

function defaultProductUpdateSource(): ProductUpdateSource {
  return {
    channel: 'stable',
    feedUrl: 'https://github.com/stablyai/orca/releases/latest/download',
    github: {
      repo: 'stablyai/orca',
      atomFeedUrl: 'https://github.com/stablyai/orca/releases.atom',
      releasesDownloadBase: 'https://github.com/stablyai/orca/releases/download',
      releasesApiUrl: 'https://api.github.com/repos/stablyai/orca/releases'
    },
    provider: 'github'
  }
}

export function createProductUpdaterTestMocks(): ProductUpdaterTestState & {
  productUpdaterModuleFactories: ProductUpdaterModuleFactories
  resetProductUpdaterMocks: () => void
} {
  const productUpdatePolicy = { configured: true }
  const productUpdateSourceState: { value: ProductUpdateSource | null } = {
    value: defaultProductUpdateSource()
  }
  const installProductUpdaterNetworkBoundaryMock = vi.fn()
  const fetchProductUpdateManifestMock = vi.fn()
  const linuxRootPackageInstallPolicy = { manual: false }

  return {
    productUpdatePolicy,
    productUpdateSourceState,
    installProductUpdaterNetworkBoundaryMock,
    fetchProductUpdateManifestMock,
    linuxRootPackageInstallPolicy,
    productUpdaterModuleFactories: {
      productUpdatePolicy: () => ({
        hasConfiguredProductUpdateChannel: () => productUpdatePolicy.configured
      }),
      productUpdateSource: () => ({
        resolveProductUpdateSource: () => productUpdateSourceState.value,
        resolveProductUpdateFeedUrl: (source, platform, arch) => {
          if (source.provider === 'github') {
            return source.feedUrl
          }
          const platforms: Record<string, string> = {
            darwin: 'macos',
            linux: 'linux',
            win32: 'windows'
          }
          return platforms[platform] && (arch === 'x64' || arch === 'arm64')
            ? `${source.feedUrl}${source.channel}/${platforms[platform]}/${arch}/`
            : null
        }
      }),
      productUpdaterNetworkBoundary: () => ({
        installProductUpdaterNetworkBoundary: installProductUpdaterNetworkBoundaryMock
      }),
      productUpdaterSession: () => ({
        fetchWithProductUpdaterSession: fetchProductUpdateManifestMock
      }),
      linuxRootPackageInstallPolicy: () => ({
        requiresManualLinuxRootPackageInstall: () => linuxRootPackageInstallPolicy.manual
      })
    },
    resetProductUpdaterMocks: () => {
      productUpdatePolicy.configured = true
      productUpdateSourceState.value = defaultProductUpdateSource()
      installProductUpdaterNetworkBoundaryMock.mockReset()
      fetchProductUpdateManifestMock
        .mockReset()
        .mockResolvedValue(new Response('version: 1.0.52\n'))
      linuxRootPackageInstallPolicy.manual = false
    }
  }
}
