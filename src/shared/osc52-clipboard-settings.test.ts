import { describe, expect, it } from 'vitest'
import { normalizeOsc52ClipboardDefaultOn } from './osc52-clipboard-settings'

describe('current OSC52 clipboard authorization choice', () => {
  it.each([undefined, {}, { terminalAllowOsc52Clipboard: true }])(
    'defaults absent clipboard settings on: %o',
    (settings) => {
      expect(normalizeOsc52ClipboardDefaultOn(settings)).toEqual({
        terminalAllowOsc52Clipboard: true
      })
    }
  )
  it('never promotes an explicit false to clipboard authorization', () => {
    const normalized = normalizeOsc52ClipboardDefaultOn({ terminalAllowOsc52Clipboard: false })
    expect(normalized).toEqual({ terminalAllowOsc52Clipboard: false })
    expect(normalizeOsc52ClipboardDefaultOn(normalized)).toEqual(normalized)
  })
})
