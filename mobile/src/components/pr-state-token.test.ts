import { describe, expect, it } from 'vitest'
import { prStateToken } from './pr-state-token'
import { prStateBadge } from './pr-sidebar/pr-checks-presentation'
import { statusColor } from './pr-sidebar/pr-sidebar-status-color'
import { darkTheme, lightTheme } from '../theme/mobile-theme'

describe('prStateToken', () => {
  it('maps PR states to the desktop-matching status palette', () => {
    expect(prStateToken('merged')).toBe('statusPurple')
    expect(prStateToken('open')).toBe('statusGreen')
    expect(prStateToken('closed')).toBe('statusRed')
    expect(prStateToken('draft')).toBe('textSecondary')
  })

  it('is case-insensitive and falls back to muted for unknown states', () => {
    expect(prStateToken('MERGED')).toBe('statusPurple')
    expect(prStateToken('unknown')).toBe('textSecondary')
    expect(prStateToken('')).toBe('textSecondary')
  })

  it('resolves to the expected concrete colors', () => {
    for (const theme of [lightTheme, darkTheme]) {
      expect(statusColor(prStateToken('merged'), theme)).toBe(theme.color.brand.primary)
      expect(statusColor(prStateToken('open'), theme)).toBe(theme.color.status.success)
      expect(statusColor(prStateToken('closed'), theme)).toBe(theme.color.status.danger)
      expect(statusColor(prStateToken('draft'), theme)).toBe(theme.color.text.secondary)
    }
  })
})

describe('workspace-list and PR-sidebar palette agreement', () => {
  // Both surfaces must resolve the SAME color for the same state so the
  // linked-PR badge and the sidebar state badge never drift.
  it.each(['open', 'closed', 'merged', 'draft'] as const)(
    'sidebar badge and list badge agree for %s',
    (state) => {
      const listColor = statusColor(prStateToken(state))
      const sidebarColor = statusColor(prStateBadge(state).token)
      expect(sidebarColor).toBe(listColor)
    }
  )
})
