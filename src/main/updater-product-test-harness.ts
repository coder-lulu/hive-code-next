import { vi } from 'vitest'
import type { Mock } from 'vitest'

type ProductUpdaterSpy = Mock<(...args: unknown[]) => unknown>

export type ProductUpdateSource = {
  channel: 'stable' | 'rc'
  feedUrl: string
  github: {
    repo: string
    atomFeedUrl: string
    releasesDownloadBase: string
    releasesApiUrl: string
  } | null
}

export type ProductUpdaterModuleFactories = {
  productUpdatePolicy: () => { hasConfiguredProductUpdateChannel: () => boolean }
  productUpdateSource: () => { resolveProductUpdateSource: () => ProductUpdateSource | null }
  productUpdaterNetworkBoundary: () => { installProductUpdaterNetworkBoundary: ProductUpdaterSpy }
  linuxRootPackageInstallPolicy: () => { requiresManualLinuxRootPackageInstall: () => boolean }
}

export type ProductUpdaterTestState = {
  productUpdatePolicy: { configured: boolean }
  productUpdateSourceState: { value: ProductUpdateSource | null }
  installProductUpdaterNetworkBoundaryMock: ProductUpdaterSpy
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
    }
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
  const linuxRootPackageInstallPolicy = { manual: false }

  return {
    productUpdatePolicy,
    productUpdateSourceState,
    installProductUpdaterNetworkBoundaryMock,
    linuxRootPackageInstallPolicy,
    productUpdaterModuleFactories: {
      productUpdatePolicy: () => ({
        hasConfiguredProductUpdateChannel: () => productUpdatePolicy.configured
      }),
      productUpdateSource: () => ({
        resolveProductUpdateSource: () => productUpdateSourceState.value
      }),
      productUpdaterNetworkBoundary: () => ({
        installProductUpdaterNetworkBoundary: installProductUpdaterNetworkBoundaryMock
      }),
      linuxRootPackageInstallPolicy: () => ({
        requiresManualLinuxRootPackageInstall: () => linuxRootPackageInstallPolicy.manual
      })
    },
    resetProductUpdaterMocks: () => {
      productUpdatePolicy.configured = true
      productUpdateSourceState.value = defaultProductUpdateSource()
      installProductUpdaterNetworkBoundaryMock.mockReset()
      linuxRootPackageInstallPolicy.manual = false
    }
  }
}
