import {
  OFFICIAL_MARKETPLACE_OWNER,
  OFFICIAL_MARKETPLACE_REPOSITORY,
  OFFICIAL_PLUGIN_PUBLISHER,
  parseGitRepositoryIdentity
} from './plugin-marketplace'

/** Display form of a plugin location, naming the directory when it is not the repository root. */
export function pluginSourceLabel(source: { url: string; path?: string }): string {
  return source.path ? `${source.url} (${source.path})` : source.url
}

export function isOfficialOrganizationGitSource(url: string): boolean {
  const source = parseGitRepositoryIdentity(url)
  return source?.host === 'github.com' && source.owner.toLowerCase() === OFFICIAL_PLUGIN_PUBLISHER
}

export function isOfficialMarketplaceGitSource(url: string): boolean {
  const source = parseGitRepositoryIdentity(url)
  return (
    source?.host === 'github.com' &&
    source.owner.toLowerCase() === OFFICIAL_MARKETPLACE_OWNER &&
    source.repository.toLowerCase() === OFFICIAL_MARKETPLACE_REPOSITORY
  )
}

export function isConfiguredMarketplaceGitSource(
  url: string,
  configuredUrl: string | null
): boolean {
  if (!configuredUrl) {
    return false
  }
  const source = parseGitRepositoryIdentity(url)
  const configured = parseGitRepositoryIdentity(configuredUrl)
  return (
    source !== null &&
    configured !== null &&
    source.host === configured.host &&
    source.path === configured.path
  )
}
