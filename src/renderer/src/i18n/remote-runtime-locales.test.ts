import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import es from './locales/es.json'
import ko from './locales/ko.json'

const localizedCatalogs = { es, ko }

const keysThatMustBeLocalized = [
  'auto.hooks.useIpcEvents.ef223fbb6b',
  'auto.hooks.useIpcEvents.6573cfe955',
  'auto.hooks.useIpcEvents.unresolvedTerminalWorktreeOwner',
  'auto.components.settings.RuntimeEnvironmentsPane.updateAvailableOne',
  'auto.components.settings.RuntimeEnvironmentsPane.updatesAvailable',
  'auto.components.settings.RuntimeEnvironmentsPane.updateServer',
  'auto.components.settings.RuntimeEnvironmentsPane.removeActiveServerBlocked',
  'auto.components.settings.RuntimeEnvironmentsPane.removeActiveServerDescription',
  'auto.components.settings.RuntimeEnvironmentsPane.updatingServers',
  'auto.components.settings.GeneralRemoteServerUpdates.serverCount',
  'auto.components.settings.GeneralRemoteServerUpdates.availableCount',
  'auto.components.settings.GeneralRemoteServerUpdates.currentCount',
  'auto.components.settings.GeneralRemoteServerUpdates.manualCount',
  'auto.components.settings.GeneralRemoteServerUpdates.offlineCount',
  'auto.components.settings.GeneralRemoteServerUpdates.updating',
  'auto.components.settings.GeneralRemoteServerUpdates.reviewUpdates',
  'auto.components.settings.GeneralRemoteServerUpdates.serverCountOne',
  'auto.components.settings.GeneralRemoteServerUpdates.reviewUpdateOne',
  'auto.components.settings.RemoteServerUpdateDialog.versionUnavailable',
  'auto.components.settings.RemoteServerUpdateDialog.restartingHelp',
  'auto.components.settings.RemoteServerUpdateDialog.retry',
  'auto.components.settings.RemoteServerUpdateDialog.restartWarning',
  'auto.components.settings.RemoteServerUpdateDialog.checking',
  'auto.components.settings.RemoteServerUpdateDialog.updating',
  'auto.components.settings.RemoteServerUpdateDialog.updateOne',
  'auto.components.settings.RemoteServerUpdateDialog.downloadProgress',
  'auto.components.settings.RemoteServerUpdateDialog.liveTabOne',
  'auto.components.settings.RemoteServerUpdateDialog.liveTabs',
  'auto.components.settings.RemoteServerUpdateDialog.livePaneOne',
  'auto.components.settings.RemoteServerUpdateDialog.livePanes',
  'runtimeRpc.startupFailure.unknownCause',
  'runtimeRpc.startupFailure.continueButton'
] as const

function lookup(catalog: unknown, key: string): string | undefined {
  const value = key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
      catalog
    )
  return typeof value === 'string' ? value : undefined
}

function interpolationTokens(value: string): string[] {
  return (value.match(/\{\{[^}]+\}\}/g) ?? []).sort()
}

describe('remote runtime locale copy', () => {
  it.each(Object.entries(localizedCatalogs))(
    '%s does not fall back to English for remote runtime status and recovery copy',
    (locale, catalog) => {
      for (const key of keysThatMustBeLocalized) {
        const english = lookup(en, key)
        const localized = lookup(catalog, key)

        expect(english, `en:${key}`).toBeDefined()
        expect(localized, `${locale}:${key}`).toBeDefined()
        expect(localized, `${locale}:${key}`).not.toBe(english)
        expect(interpolationTokens(localized ?? ''), `${locale}:${key}`).toEqual(
          interpolationTokens(english ?? '')
        )
      }
    }
  )
})
