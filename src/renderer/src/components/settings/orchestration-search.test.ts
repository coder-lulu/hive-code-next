import { describe, expect, it } from 'vitest'
import { matchesSettingsSearch } from './settings-search'
import { getOrchestrationPaneSearchEntries } from './orchestration-search'

describe('Orchestration settings search', () => {
  it('keeps the old nested worker query mapped to the renamed depth setting', () => {
    const entries = getOrchestrationPaneSearchEntries()
    expect(matchesSettingsSearch('nested worker', entries)).toBe(true)
    expect(
      entries.find((entry) => 'id' in entry && entry.id === 'nested-worker-depth')
    ).toMatchObject({
      title: 'Maximum child-agent spawning depth',
      targetSectionId: 'nested-worker-depth'
    })
  })

  it('does not expose the depth setting to Web Client search', () => {
    expect(
      matchesSettingsSearch(
        'nested worker',
        getOrchestrationPaneSearchEntries({ includeNestedWorkerDepth: false })
      )
    ).toBe(false)
  })
})
