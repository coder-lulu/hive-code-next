// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { APP_DISPLAY_NAME } from '@/product-brand'
import { runTerminalPhase } from './review-notes-terminal-phase'

describe('runTerminalPhase product copy', () => {
  it('renders the configured product name without injecting upstream markup', async () => {
    const term = document.createElement('div')
    term.innerHTML = [
      '<div data-term-line-start></div>',
      '<div data-term-line-loaded></div>',
      '<div data-term-line-ack-0></div>',
      '<div data-term-line-ack-1></div>',
      '<div data-term-line-tail></div>'
    ].join('')
    const diffScroll = document.createElement('div')

    await runTerminalPhase({
      term,
      diffScroll,
      wait: async () => undefined,
      isCancelled: () => false,
      getNewLineNo: () => '42'
    })

    const loaded = term.querySelector<HTMLElement>('[data-term-line-loaded]')
    expect(loaded?.textContent).toContain(`review notes from ${APP_DISPLAY_NAME}`)
    expect(loaded?.textContent).not.toContain('Orca')
    expect(loaded?.querySelector('.ravs-term-check')?.textContent).toBe('✓')
  })
})
