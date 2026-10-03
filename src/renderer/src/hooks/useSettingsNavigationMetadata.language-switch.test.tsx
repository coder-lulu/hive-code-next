// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

import { i18n, setRendererPluginLanguagePacks } from '../i18n/i18n'
import { pluginLanguageResourceId } from '../../../shared/plugins/plugin-language-pack-artifact'
import { useSettingsNavigationMetadata } from './useSettingsNavigationMetadata'
import type { SettingsNavSection } from '@/lib/settings-navigation-types'

// Why: the Settings sidebar / Cmd+J nav labels are produced by translate() at
// build time and memoized. Before the fix the memo deps excluded the active
// locale, so a live language switch left the nav stuck in the old language
// until Settings was remounted. This pins that the labels retranslate live.

const roots: Root[] = []
let latest: SettingsNavSection[] | null = null

function Probe(): null {
  latest = useSettingsNavigationMetadata()
  return null
}

async function renderProbe(): Promise<void> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(createElement(Probe))
  })
}

function agentsTitle(): string | undefined {
  return latest?.find((section) => section.id === 'agents')?.title
}

function packageSourceTitle(): string | undefined {
  return latest
    ?.find((section) => section.id === 'agents')
    ?.searchEntries.find((entry) => entry.targetSectionId === 'agent-npm-registry')?.title
}

afterEach(async () => {
  for (const root of roots) {
    await act(async () => {
      root.unmount()
    })
  }
  roots.length = 0
  latest = null
  setRendererPluginLanguagePacks([])
  await act(async () => {
    await i18n.changeLanguage('en')
  })
  vi.restoreAllMocks()
})

it('retranslates the settings nav labels when the UI language changes live', async () => {
  await act(async () => {
    await i18n.changeLanguage('en')
  })
  await renderProbe()
  expect(agentsTitle()).toBe('Agents')

  // Same path as the Settings → Appearance language switch.
  await act(async () => {
    await i18n.changeLanguage('es')
  })

  // Without the active-locale memo dep this stays 'Agents' (stale cache).
  expect(agentsTitle()).toBe('Agentes')
})

it('refreshes navigation after replacing a catalog without changing its language ID', async () => {
  const id = 'plugin:review.navigation/fr' as const
  const pack = {
    id,
    resourceLanguage: pluginLanguageResourceId(id),
    pluginKey: 'review.navigation',
    locale: 'fr',
    catalog: {
      auto: { hooks: { useSettingsNavigationMetadata: { b49abbd2f7: 'Anciens agents' } } },
      agentsSettings: { packageSource: 'Ancienne source' }
    }
  }
  setRendererPluginLanguagePacks([pack])
  await i18n.changeLanguage(pack.resourceLanguage)
  await renderProbe()
  expect(agentsTitle()).toBe('Anciens agents')
  expect(packageSourceTitle()).toBe('Ancienne source')

  await act(async () => {
    setRendererPluginLanguagePacks([
      {
        ...pack,
        catalog: {
          auto: { hooks: { useSettingsNavigationMetadata: { b49abbd2f7: 'Nouveaux agents' } } },
          agentsSettings: { packageSource: 'Nouvelle source' }
        }
      }
    ])
    await i18n.changeLanguage(pack.resourceLanguage)
  })

  expect(agentsTitle()).toBe('Nouveaux agents')
  expect(packageSourceTitle()).toBe('Nouvelle source')
})
