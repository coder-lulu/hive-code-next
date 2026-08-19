import { hivecodeProductConfig } from './generated/product-config'

const PRODUCT_UPDATE_CHANNELS = ['stable', 'rc'] as const
type ProductUpdateChannel = (typeof PRODUCT_UPDATE_CHANNELS)[number]
const PRODUCT_UPDATE_PROVIDERS = ['github', 'hivecloud'] as const
type ProductUpdateProvider = (typeof PRODUCT_UPDATE_PROVIDERS)[number]
const HIVECLOUD_DESKTOP_UPDATE_PATH = '/hive/v1/updates/desktop/'

type ProductUpdateManifestLike = {
  desktop: {
    updateChannel: string | null
    updateProvider: string | null
    updateRepository: string | null
  }
  endpoints: {
    update: string | null
  }
}

export type ProductGitHubUpdateSource = {
  repo: string
  atomFeedUrl: string
  releasesDownloadBase: string
  releasesApiUrl: string
}

export type ProductUpdateSource = {
  channel: ProductUpdateChannel
  feedUrl: string
  github: ProductGitHubUpdateSource | null
  provider: ProductUpdateProvider
}

const HIVECLOUD_UPDATE_PLATFORMS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'macos',
  linux: 'linux',
  win32: 'windows'
}

export function resolveProductUpdateFeedUrl(
  source: ProductUpdateSource,
  platform: NodeJS.Platform,
  arch: string
): string | null {
  if (source.provider === 'github') {
    return source.feedUrl
  }
  const feedPlatform = HIVECLOUD_UPDATE_PLATFORMS[platform]
  if (!feedPlatform || (arch !== 'x64' && arch !== 'arm64')) {
    return null
  }
  return new URL(`${source.channel}/${feedPlatform}/${arch}/`, source.feedUrl).href
}

function resolveGitHubUpdateSource(url: URL): ProductGitHubUpdateSource | null {
  if (url.origin !== 'https://github.com' || url.pathname.includes('%')) {
    return null
  }
  const match = url.pathname.match(
    /^\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\/([A-Za-z0-9._-]{1,100})\/releases\/latest\/download$/
  )
  if (!match) {
    return null
  }
  const repo = `${match[1]}/${match[2]}`
  return {
    repo,
    atomFeedUrl: `https://github.com/${repo}/releases.atom`,
    releasesDownloadBase: `https://github.com/${repo}/releases/download`,
    releasesApiUrl: `https://api.github.com/repos/${repo}/releases`
  }
}

export function resolveProductUpdateSource(
  config: ProductUpdateManifestLike = hivecodeProductConfig
): ProductUpdateSource | null {
  const configuredChannel = config.desktop.updateChannel?.trim()
  const configuredProvider = config.desktop.updateProvider?.trim()
  const approvedRepository = config.desktop.updateRepository?.trim()
  const endpoint = config.endpoints.update?.trim()
  if (
    !configuredChannel ||
    !PRODUCT_UPDATE_CHANNELS.includes(configuredChannel as ProductUpdateChannel) ||
    !configuredProvider ||
    !PRODUCT_UPDATE_PROVIDERS.includes(configuredProvider as ProductUpdateProvider) ||
    !endpoint
  ) {
    return null
  }
  const channel = configuredChannel as ProductUpdateChannel
  const provider = configuredProvider as ProductUpdateProvider

  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return null
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    return null
  }

  const github = resolveGitHubUpdateSource(url)
  if (provider === 'github') {
    if (!approvedRepository || !github) {
      return null
    }
    if (github.repo.toLowerCase() !== approvedRepository.toLowerCase()) {
      return null
    }
    return {
      channel,
      feedUrl: url.toString(),
      github,
      provider
    }
  }

  if (approvedRepository || github || url.pathname !== HIVECLOUD_DESKTOP_UPDATE_PATH) {
    return null
  }
  return {
    channel,
    feedUrl: url.toString(),
    github: null,
    provider
  }
}
