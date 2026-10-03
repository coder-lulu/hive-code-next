import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatSites, scanWebSocketServerBinds } from './websocket-server-bind-scan'

/**
 * Hold the bind address at the tree level rather than per call site.
 *
 * Every one of the ~30 `.listen(0, ...)` calls in this repo already passes
 * '127.0.0.1'; 7 of 7 `new WebSocketServer({ port })` calls did not. Authors know
 * the convention -- `ws` just never asks, because `{ port }` alone binds the
 * wildcard without a word. That silence is what this test replaces.
 *
 * The allowlist only shrinks. A new wildcard bind fails here even where it looks
 * harmless today, because harmless-looking is exactly what the seven were.
 */
/** The ratchet, held as data so it reads as the list it is. */
const WILDCARD_BIND_ALLOWLIST: readonly string[] = readFileSync(
  join(__dirname, '__fixtures__', 'websocket-server-wildcard-bind-allowlist.txt'),
  'utf8'
)
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('#'))

/**
 * The true count of constructions that bind a port without pinning a host.
 *
 * May only ever be DECREASED, and only by pinning a host. Raising it is never
 * the fix.
 */
const WILDCARD_BIND_PIN = 1

// Upstream has 25 sites: seven in the retired relay tests are removed and the
// HiveRelay mock adds one. Pin the actual 19-site corpus so parser regressions
// cannot be hidden by unrelated new construction sites.
const KNOWN_CONSTRUCTIONS = readFileSync(
  join(__dirname, '__fixtures__', 'websocket-server-construction-corpus.txt'),
  'utf8'
)
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))

describe('WebSocketServer loopback bind boundary', () => {
  const repoRoot = resolve(__dirname, '..', '..')
  const scan = scanWebSocketServerBinds(repoRoot)
  const offenders = scan.wildcardBound.map((site) => site.path)

  it('scans a plausible number of files', () => {
    // A broken root or extension list would make the guard silently vacuous.
    expect(scan.filesScanned).toBeGreaterThan(5_000)
  })

  it('still recognizes the known construction sites', () => {
    const actual = [
      ...scan.wildcardBound,
      ...scan.loopbackBound,
      ...scan.attached,
      ...scan.opaque
    ].map((site) => site.path)
    for (const known of KNOWN_CONSTRUCTIONS) {
      const index = actual.indexOf(known)
      expect(index, `Scanner lost a reviewed construction in ${known}`).toBeGreaterThanOrEqual(0)
      actual.splice(index, 1)
    }
    expect(scan.constructions).toBeGreaterThanOrEqual(KNOWN_CONSTRUCTIONS.length)
  })

  it('can read the options of every construction it found', () => {
    // An unreadable shape is never assumed safe: it could be hiding a host, or
    // hiding the absence of one. Rewrite it as a plain object literal.
    expect(
      scan.opaque.map((site) => `${site.path}:${site.line} -- ${site.reason}`),
      'WebSocketServer options that this guard cannot read.'
    ).toEqual([])
  })

  it('has no wildcard-bound server outside the allowlist', () => {
    const unlisted = scan.wildcardBound.filter(
      (site) => !WILDCARD_BIND_ALLOWLIST.includes(site.path)
    )
    expect(
      formatSites(unlisted),
      "New WebSocketServer that binds a port without a host. Pass host: '127.0.0.1' so a foreign " +
        'loopback listener cannot claim the port and answer in its place.'
    ).toEqual([])
  })

  it('has no stale allowlist entry', () => {
    // Why this direction matters too: an entry left behind after the file was
    // fixed hides the next regression in that same path.
    const stale = WILDCARD_BIND_ALLOWLIST.filter((path) => !offenders.includes(path))
    expect(stale, 'Allowlist entry no longer binds the wildcard — delete the line.').toEqual([])
  })

  it('holds the wildcard-bind count at the pin', () => {
    // Bounding by the allowlist's own length would prove nothing: the two move
    // together, so appending a line to silence a failure would keep the bound
    // satisfied. The pin is a literal so that widening takes a second edit.
    expect(
      scan.wildcardBound.length,
      `${scan.wildcardBound.length} constructions bind the wildcard; the pin is ` +
        `${WILDCARD_BIND_PIN}. Never raise the pin -- pass host: '127.0.0.1' instead.`
    ).toBeLessThanOrEqual(WILDCARD_BIND_PIN)
    // A pin left above reality is how a ratchet rots: it re-opens room for the
    // next wildcard bind to land for free.
    expect(
      scan.wildcardBound.length,
      `Only ${scan.wildcardBound.length} constructions bind the wildcard. Lower ` +
        `WILDCARD_BIND_PIN to ${scan.wildcardBound.length} to keep the ground you just took.`
    ).toBeGreaterThanOrEqual(WILDCARD_BIND_PIN)
  })
})
