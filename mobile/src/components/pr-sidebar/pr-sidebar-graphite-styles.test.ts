import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  StyleSheet: {
    hairlineWidth: 1,
    create: <T>(styles: T) => styles
  }
}))

import { darkTheme, lightTheme } from '../../theme/mobile-theme'
import { createMobilePrSidebarStyles } from './mobile-pr-sidebar-styles'
import { createPrActionsStyles } from './pr-actions-styles'
import { createPrAiTriageStyles } from './pr-ai-triage-styles'
import { createPrCommentComposerStyles } from './pr-comment-composer-styles'
import { createPrCommentsStyles } from './pr-comments-styles'
import { createPrConflictStyles } from './pr-conflict-styles'
import { createPrCreateEmptyStateStyles } from './pr-create-empty-state-styles'
import { createReviewerPickerStyles } from './reviewer-picker-styles'

describe('PR sidebar Graphite styles', () => {
  it.each([lightTheme, darkTheme])('uses the $scheme semantic theme', (theme) => {
    const shared = createMobilePrSidebarStyles(theme)
    const actions = createPrActionsStyles(theme)
    const triage = createPrAiTriageStyles(theme)
    const composer = createPrCommentComposerStyles(theme)
    const comments = createPrCommentsStyles(theme)
    const conflicts = createPrConflictStyles(theme)
    const empty = createPrCreateEmptyStateStyles(theme)
    const reviewerPicker = createReviewerPickerStyles(theme)

    expect(shared.section.backgroundColor).toBe(theme.color.bg.surface)
    expect(shared.branchPill.backgroundColor).toBe(theme.color.bg.subtle)
    expect(shared.prTitle.color).toBe(theme.color.text.primary)
    expect(actions.actionButtonMerge.backgroundColor).toBe(theme.color.status.success)
    expect(actions.actionButtonDestructiveText.color).toBe(theme.color.status.danger)
    expect(triage.triageStrip.borderColor).toBe(theme.color.status.danger)
    expect(composer.input.backgroundColor).toBe(theme.color.bg.subtle)
    expect(comments.card.backgroundColor).toBe(theme.color.bg.surface)
    expect(comments.actionButtonDangerText.color).toBe(theme.color.status.danger)
    expect(conflicts.commandBox.backgroundColor).toBe(theme.color.bg.subtle)
    expect(empty.section.backgroundColor).toBe(theme.color.bg.surface)
    expect(reviewerPicker.search.backgroundColor).toBe(theme.color.bg.surface)
  })

  it('keeps primary and destructive actions visually distinct', () => {
    const actions = createPrActionsStyles(lightTheme)
    const comments = createPrCommentsStyles(lightTheme)

    expect(actions.actionButtonMerge.backgroundColor).not.toBe(
      actions.actionButtonDestructiveText.color
    )
    expect(comments.actionButtonDanger.borderColor).toBe(lightTheme.color.status.danger)
    expect(actions.actionButton.minHeight).toBe(lightTheme.size.minimumTouchTarget)
  })
})
