import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  StyleSheet: {
    hairlineWidth: 1,
    create: <T>(styles: T) => styles
  }
}))

import {
  applyMobileColorScheme,
  paletteForScheme,
  darkTheme,
  lightTheme
} from '../../theme/mobile-theme'
import { createMobilePrSidebarStyles } from './mobile-pr-sidebar-styles'
import { createPrActionsStyles } from './pr-actions-styles'
import { prAiTriageStyles } from './pr-ai-triage-styles'
import { composerInputStyles } from '../composer-input/composer-input-styles'
import { prCommentsStyles } from './pr-comments-styles'
import { prConflictStyles } from './pr-conflict-styles'
import { prCreateEmptyStateStyles } from './pr-create-empty-state-styles'
import { createReviewerPickerStyles } from './reviewer-picker-styles'

afterEach(() => applyMobileColorScheme('dark'))

describe('PR sidebar Graphite styles', () => {
  it.each([lightTheme, darkTheme])('uses the $scheme semantic theme', (theme) => {
    applyMobileColorScheme(theme.scheme)
    const palette = paletteForScheme(theme.scheme)
    const shared = createMobilePrSidebarStyles(theme)
    const actions = createPrActionsStyles(theme)
    const triage = prAiTriageStyles
    const composer = composerInputStyles
    const comments = prCommentsStyles
    const conflicts = prConflictStyles
    const empty = prCreateEmptyStateStyles
    const reviewerPicker = createReviewerPickerStyles(theme)

    expect(shared.section.backgroundColor).toBe(theme.color.bg.surface)
    expect(shared.branchPill.backgroundColor).toBe(theme.color.bg.subtle)
    expect(shared.prTitle.color).toBe(theme.color.text.primary)
    expect(actions.actionButtonMerge.backgroundColor).toBe(theme.color.status.success)
    expect(actions.actionButtonDestructiveText.color).toBe(theme.color.status.dangerText)
    expect(triage.triageStrip.borderColor).toBe(palette.statusRed)
    expect(composer.box.backgroundColor).toBe(palette.composerSurface)
    expect(composer.messageText.fontSize).toBe(16)
    expect(comments.card.backgroundColor).toBe(palette.bgPanel)
    expect(comments.actionButtonText.color).toBe(palette.textSecondary)
    expect(conflicts.commandBox.backgroundColor).toBe(palette.bgRaised)
    expect(empty.section.backgroundColor).toBe(palette.bgPanel)
    expect(reviewerPicker.search.backgroundColor).toBe(theme.color.bg.surface)
  })

  it('keeps primary and destructive actions visually distinct', () => {
    const actions = createPrActionsStyles(lightTheme)
    const comments = prCommentsStyles

    expect(actions.actionButtonMerge.backgroundColor).not.toBe(
      actions.actionButtonDestructiveText.color
    )
    expect(comments.card.borderColor).toBe(paletteForScheme('dark').borderSubtle)
    // Delete now carries its destructive appearance in the confirmation, not the compact row.
    const card = readFileSync(new URL('./PRCommentCard.tsx', import.meta.url), 'utf8')
    const confirmation = readFileSync(new URL('../ConfirmModal.tsx', import.meta.url), 'utf8')
    expect(card).toMatch(/<ConfirmModal[\s\S]*?destructive[\s\S]*?actions\.deleteComment/)
    expect(confirmation).toContain('destructive ? styles.destructiveButton : styles.confirmButton')
    expect(confirmation).toContain('backgroundColor: colors.statusRed')
    expect(actions.actionButton.minHeight).toBe(lightTheme.size.minimumTouchTarget)
  })
})
