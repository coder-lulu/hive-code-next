import { describe, expect, it } from 'vitest'

import { getMobilePaneSearchEntries } from './mobile-pane-search'

describe('getMobilePaneSearchEntries', () => {
  // Why: the network entries were split into their own catalog and spliced back
  // in. Search ranking breaks ties by index, so a reorder silently reranks rows.
  it('keeps Network Interface in its original catalog position', () => {
    expect(getMobilePaneSearchEntries().map((entry) => entry.title)).toEqual([
      'Mobile Pairing',
      'Connected Devices',
      'Network Interface',
      'When you leave the mobile app'
    ])
  })
})
