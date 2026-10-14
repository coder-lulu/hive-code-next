import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { XTERM_HTML } from './terminal-webview-html'

// Why: every other WebView test exercises one slice of the document, so an edit to an
// uncovered region ships silently. A diff here means the emitted WebView source changed —
// update these values only when that change is deliberate, and only after checking the
// document still runs. Refactors that merely move slice boundaries must leave them alone.
// Rebuilt with esbuild 0.28.2 and syntax folding disabled to retain xterm's DECRQM enum.
// xterm beta.304, unicode11 beta.301 and webgl beta.300 change only the engine payload.
// The document-style, engine and theme suites verify the changed seams.
const EXPECTED_SHA256 = '3c614fad1540e8330a388a492844f3eb04ddc89f9c12a7c45a80156a356812a5'
const EXPECTED_LENGTH = 751595

describe('terminal WebView payload', () => {
  it('composes the expected document', () => {
    expect(XTERM_HTML.length).toBe(EXPECTED_LENGTH)
    expect(createHash('sha256').update(XTERM_HTML, 'utf8').digest('hex')).toBe(EXPECTED_SHA256)
  })
})
