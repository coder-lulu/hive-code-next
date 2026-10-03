import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { XTERM_HTML } from './terminal-webview-html'

// Why: every other WebView test exercises one slice of the document, so an edit to an
// uncovered region ships silently. A diff here means the emitted WebView source changed —
// update these values only when that change is deliberate, and only after checking the
// document still runs. Refactors that merely move slice boundaries must leave them alone.
// Rebuilt after the upstream modular document merge and Hive terminal theme CSS integration.
// The document-style, engine and theme suites verify the changed seams.
const EXPECTED_SHA256 = '8b5557afb7dc3e31d86c021ba272705ffe6db3040f987a41431a0c8f8ce5500a'
const EXPECTED_LENGTH = 747244

describe('terminal WebView payload', () => {
  it('composes the expected document', () => {
    expect(XTERM_HTML.length).toBe(EXPECTED_LENGTH)
    expect(createHash('sha256').update(XTERM_HTML, 'utf8').digest('hex')).toBe(EXPECTED_SHA256)
  })
})
