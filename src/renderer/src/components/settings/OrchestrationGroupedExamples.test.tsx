// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getOrchestrationUsageExamples } from '@/lib/orchestration-usage-examples'
import { OrchestrationGroupedExamples } from './OrchestrationGroupedExamples'

afterEach(cleanup)

describe('OrchestrationGroupedExamples', () => {
  it('opens handoff for a navigation target and lets the user collapse it until the next visit', () => {
    const { rerender } = render(<OrchestrationGroupedExamples />)
    const handoff = screen.getAllByRole('button', { expanded: false })[0]

    rerender(<OrchestrationGroupedExamples navigationTargetSectionId="orchestration-examples" />)
    expect(handoff.getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(handoff)
    expect(handoff.getAttribute('aria-expanded')).toBe('false')

    rerender(<OrchestrationGroupedExamples navigationTargetSectionId="orchestration" />)
    expect(handoff.getAttribute('aria-expanded')).toBe('false')

    rerender(<OrchestrationGroupedExamples navigationTargetSectionId="orchestration-examples" />)
    expect(handoff.getAttribute('aria-expanded')).toBe('true')
  })

  it('opens handoff on the initial targeted render', () => {
    render(<OrchestrationGroupedExamples navigationTargetSectionId="orchestration-examples" />)
    expect(screen.getAllByRole('button', { expanded: true })).toHaveLength(1)
  })

  it('keeps five prompts in three groups and opens the existing copy dialog on selection', async () => {
    const writeClipboardText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { ...window.api, ui: { ...window.api?.ui, writeClipboardText } }
    })
    render(<OrchestrationGroupedExamples />)

    const groups = screen.getAllByRole('button', { expanded: false })
    expect(groups).toHaveLength(3)
    const examples = getOrchestrationUsageExamples()
    const expectedGroups = [
      examples.filter((example) => ['handoff', 'worktree-handoff'].includes(example.id)),
      examples.filter((example) => ['child-sequence', 'child-parallel'].includes(example.id)),
      examples.filter((example) => example.id === 'child-worktrees')
    ]

    for (const [index, group] of groups.entries()) {
      fireEvent.click(group)
      for (const example of expectedGroups[index]) {
        expect(screen.getByRole('button', { name: new RegExp(example.title) })).toBeTruthy()
      }
      if (index === 0) {
        fireEvent.click(
          screen.getByRole('button', { name: new RegExp(expectedGroups[0][0].title) })
        )
        expect(screen.getByRole('dialog').textContent).toContain(expectedGroups[0][0].prompt)
        fireEvent.click(screen.getByRole('button', { name: 'Copy prompt' }))
        await waitFor(() =>
          expect(writeClipboardText).toHaveBeenCalledWith(expectedGroups[0][0].prompt)
        )
        fireEvent.click(screen.getByRole('button', { name: 'Done' }))
      }
    }
  })
})
