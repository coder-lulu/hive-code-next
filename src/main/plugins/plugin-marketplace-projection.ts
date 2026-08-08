import type {
  PluginMarketplaceEntry,
  PluginMarketplaceGitSource
} from '../../shared/plugins/plugin-marketplace'
import type {
  PluginMarketplaceCachedSnapshot,
  PluginMarketplaceRegisteredSource
} from './plugin-marketplace-store'

export type PluginMarketplaceSourceState = {
  id: string
  source: PluginMarketplaceGitSource
  addedAt: number
  marketplace: {
    name: string
    owner: string
    resolvedCommit: string
    fetchedAt: number
  } | null
  stale: boolean
  official: boolean
  error?: string
}

export type PluginMarketplaceListing = {
  marketplaceSourceId: string
  marketplaceName: string
  marketplaceOwner: string
  marketplaceCommit: string
  pluginKey: string
  source: PluginMarketplaceEntry['source']
  description?: string
  categories: string[]
  official: boolean
  bundled: boolean
  blockedByKillList?: { reason: string; advisoryUrl?: string }
}

export function projectMarketplaceSourceState(
  source: PluginMarketplaceRegisteredSource,
  snapshot: PluginMarketplaceCachedSnapshot | null,
  stale: boolean,
  official: boolean,
  error?: string
): PluginMarketplaceSourceState {
  return {
    id: source.id,
    source: source.source,
    addedAt: source.addedAt,
    marketplace: snapshot
      ? {
          name: snapshot.marketplace.name,
          owner: snapshot.marketplace.owner,
          resolvedCommit: snapshot.marketplaceCommit,
          fetchedAt: snapshot.fetchedAt
        }
      : null,
    stale,
    official,
    ...(error ? { error } : {})
  }
}
