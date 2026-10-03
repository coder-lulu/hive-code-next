import { describe, expect, it } from 'vitest'
import { APP_DISPLAY_NAME } from '@/product-brand'
import { pluginDisplayNameFromKey, pluginMonogram } from './plugin-display-name'

describe('plugin display name', () => {
  it('brands legacy plugin-key segments for display without changing the key contract', () => {
    expect(pluginDisplayNameFromKey('legacy.orca-tools')).toBe(`${APP_DISPLAY_NAME} Tools`)
    expect(pluginDisplayNameFromKey('legacy.orca-tools')).not.toContain('Orca')
  })

  it('keeps ordinary title and monogram behavior', () => {
    expect(pluginDisplayNameFromKey('example.worktree-notes')).toBe('Worktree Notes')
    expect(pluginMonogram('Worktree Notes')).toBe('WN')
  })
})
