import { hivecodeProductConfig } from './generated/product-config'

const PRODUCT_UPDATE_CHANNELS = ['stable', 'rc'] as const
type ProductUpdateChannel = (typeof PRODUCT_UPDATE_CHANNELS)[number]

type ProductUpdateManifestLike = {
  desktop: {
    updateChannel: string | null
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
  const approvedRepository = config.desktop.updateRepository?.trim()
  const endpoint = config.endpoints.update?.trim()
  if (
    !configuredChannel ||
    !PRODUCT_UPDATE_CHANNELS.includes(configuredChannel as ProductUpdateChannel) ||
    !approvedRepository ||
    !endpoint
  ) {
    return null
  }
  const channel = configuredChannel as ProductUpdateChannel

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
  if (!github || github.repo.toLowerCase() !== approvedRepository.toLowerCase()) {
    return null
  }

  return {
    channel,
    feedUrl: url.toString(),
    github
  }
}
