import { describe, expect, it } from 'vitest'
import {
  getSettingsDeepLinkScrollTargetId,
  getSettingsSectionId
} from './settings-navigation-foundations'

const representatives = new Map<string, string>()

describe('Agent Capabilities settings deep links', () => {
  it.each(['orchestration', 'computer-use'] as const)(
    'routes the old %s pane to the merged page and its own card',
    (pane) => {
      const paneSectionId = getSettingsSectionId(pane, null, representatives)
      expect(paneSectionId).toBe('agent-capabilities')
      expect(getSettingsDeepLinkScrollTargetId({ pane, repoId: null }, paneSectionId)).toBe(pane)
    }
  )

  it('preserves a named subsection under an old pane target', () => {
    const target = {
      pane: 'orchestration' as const,
      repoId: null,
      sectionId: 'nested-worker-depth'
    }
    expect(getSettingsDeepLinkScrollTargetId(target, 'agent-capabilities')).toBe(
      'nested-worker-depth'
    )
  })

  it('keeps direct merged-page targets at the page top', () => {
    const target = { pane: 'agent-capabilities' as const, repoId: null }
    expect(getSettingsDeepLinkScrollTargetId(target, 'agent-capabilities')).toBe(
      'agent-capabilities'
    )
  })
})
