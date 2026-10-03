import {
  OFFICIAL_MARKETPLACE_OWNER,
  isConfiguredMarketplaceGitSource,
  isOfficialOrganizationGitSource,
  isReservedPluginIdentity
} from '../../shared/plugins/plugin-marketplace'
import type { PluginMarketplaceFetchResult } from './plugin-marketplace-fetch'
import type { PluginMarketplaceRegisteredSource } from './plugin-marketplace-store'

export function validateMarketplaceProvenance(
  source: PluginMarketplaceRegisteredSource,
  fetched: PluginMarketplaceFetchResult,
  configuredOfficialUrl: string | null
): void {
  if (
    isConfiguredMarketplaceGitSource(source.source.url, configuredOfficialUrl) &&
    fetched.marketplace.owner.toLowerCase() !== OFFICIAL_MARKETPLACE_OWNER
  ) {
    throw new Error('official marketplace metadata has an unexpected owner')
  }
  for (const entry of fetched.marketplace.plugins) {
    if (isReservedPluginIdentity(entry.id) && !isOfficialOrganizationGitSource(entry.source.url)) {
      throw new Error(
        `reserved plugin identity ${entry.id} must resolve to the stablyai organization`
      )
    }
  }
}
