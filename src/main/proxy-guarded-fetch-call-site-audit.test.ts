import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

// Startup applies the persisted proxy to `session.defaultSession` only, and
// `installElectronProxyRequestGuard(session.defaultSession)` is what actually holds requests
// until that apply (and every later proxy transition) settles. Two ways a main-process fetcher
// can escape that fence, both audited here:
//   1. a `net.fetch` / `net.request` that names another `session` or `partition`
//   2. a `<session>.fetch(` on a `session.fromPartition(...)` session
// Known pre-existing gap outside this repo's reach: electron-updater runs on its own partition.
//
// Rule 2 entries map a file to its expected number of non-`net` `.fetch(` calls. A count change
// means a call site was added, removed, or moved: re-audit the file and update the count.
const AUDITED_NON_NET_FETCH_CALLS = new Map<string, number>([
  // Isolated cookie-jar session, proxied by createOpenCodeRequestSession before any request.
  ['main/rate-limits/opencode-go-usage-fetcher.ts', 3],
  // Isolated cookie-jar session that does NOT apply the proxy — a pre-existing gap, not a
  // regression: no proxy has ever reached this partition. Keep it listed so it stays visible.
  // Two cookie-session calls retain that gap; the third API-key call uses MainHttpClient.
  // All three responses are consumed or cancelled by parseMiniMaxUsageResponse.
  ['main/rate-limits/minimax/minimax-request-context.ts', 3],
  // Injected HttpClient, not a session: resolves to net.fetch on defaultSession
  // (main/host/electron-http-client.ts) or to the global-fetch-audited Node fallback.
  ['main/jira/authenticated-request.ts', 1],
  ['main/claude-accounts/oauth-refresh.ts', 1],
  ['main/rate-limits/codex-fetcher.ts', 1],
  // MainHttpClient paths retain the host proxy fence; each response owner consumes or cancels.
  ['main/rate-limits/claude-oauth-usage-request.ts', 1],
  ['main/rate-limits/cursor-fetcher.ts', 1],
  ['main/rate-limits/gemini-oauth-sources.ts', 2],
  ['main/rate-limits/gemini-usage-fetcher.ts', 1],
  ['main/rate-limits/grok-fetcher.ts', 1],
  ['main/rate-limits/kimi-fetcher.ts', 1],
  // The API-key response is read as text before either status or payload classification.
  ['main/rate-limits/opencode-go-usage-api.ts', 1],
  // MainHttpClient delegates to guarded net.fetch on desktop or the audited Node host port.
  ['main/hive-runtime-cloud/hive-runtime-cloud-http-client.ts', 1],
  ['main/hive-runtime-cloud/relay-host/hive-runtime-relay-region-measurement.ts', 1],
  // Preflight uses the injected MainHttpClient rather than a separate session.
  ['main/preflight/agent-installer-download.ts', 1],
  ['main/preflight/agent-version-service.ts', 1],
  // The existing electron-updater partition gap described above also applies to Hive metadata.
  // Product request/redirect allowlists still fence this partition independently of proxy state.
  ['main/product/product-updater-metadata-request.ts', 1],
  ['main/product/product-updater-session.ts', 1],
  // The same injected HttpClient, and the updater's deps.fetch that it is passed as.
  ['main/runtime/agent-state-rules/agent-state-rules-live-update.ts', 2]
])

// `globalThis.fetch` / `global.fetch` belong to global-fetch-call-site-audit.test.ts.
// `\s*` before `(`: the formatter never emits `net.fetch (url)`, but an unformatted call must not
// be a hole in a guard whose whole job is to fail on the call nobody reviewed.
const FETCH_CALL = /\.fetch\s*\(/g
const RECEIVER_IDENTIFIER = /(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*$/
const DEFAULT_SESSION_RECEIVERS = new Set(['net', 'globalThis', 'global'])
const NET_REQUEST_CALL = /(?<![.\w$])net\.(?:fetch|request)\s*\(/g
// Matches `{ session: x }` and the `{ url, session }` shorthand both `net.request` overloads take.
const SESSION_SCOPED_OPTION = /(?:^|[{,\s])(?:session|partition)\s*[:,}]/
// The sole caller passes defaultSession after proxy readiness; its host tests exercise that fence.
const AUDITED_SESSION_SCOPED_REQUESTS = new Map([['main/host/electron-proxy-login-fetch.ts', 1]])

/** Text between the call's parentheses, skipping string bodies so quoted parens don't unbalance. */
function callArgumentText(content: string, callEnd: number): string {
  let depth = 0
  let quote: string | null = null
  for (let index = callEnd - 1; index < content.length; index += 1) {
    const char = content[index]!
    if (quote) {
      if (char === '\\') {
        index += 1
      } else if (char === quote) {
        quote = null
      }
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      continue
    }
    if (char === '(') {
      depth += 1
    } else if (char === ')') {
      depth -= 1
      if (depth === 0) {
        return content.slice(callEnd, index)
      }
    }
  }
  return content.slice(callEnd)
}

function auditedSourceFiles(mainRoot: string): { file: string; content: string }[] {
  const files: { file: string; content: string }[] = []
  for (const entry of readdirSync(mainRoot, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) {
      continue
    }
    if (
      entry.name.endsWith('.test.ts') ||
      entry.name.endsWith('.test-fixtures.ts') ||
      entry.name.endsWith('.d.ts')
    ) {
      continue
    }
    const filePath = join(entry.parentPath, entry.name)
    files.push({
      file: `main/${relative(mainRoot, filePath).split(sep).join('/')}`,
      content: readFileSync(filePath, 'utf8')
    })
  }
  return files
}

describe('proxy-guarded fetch call-site audit (main)', () => {
  const sources = auditedSourceFiles(__dirname)

  it('keeps every net.fetch/net.request on the guarded default session', () => {
    const offenders: string[] = []
    const audited = new Map<string, number>()
    for (const { file, content } of sources) {
      for (const match of content.matchAll(NET_REQUEST_CALL)) {
        const args = callArgumentText(content, match.index + match[0].length)
        if (SESSION_SCOPED_OPTION.test(args)) {
          if (AUDITED_SESSION_SCOPED_REQUESTS.has(file)) {
            audited.set(file, (audited.get(file) ?? 0) + 1)
          } else {
            offenders.push(`${file}:${content.slice(0, match.index).split('\n').length}`)
          }
        }
      }
    }
    expect(
      offenders.sort(),
      'This request names its own session/partition, so it is not covered by ' +
        'installElectronProxyRequestGuard(session.defaultSession) and startup never applies the ' +
        'persisted proxy to it. Either drop the option, or apply the proxy to that session ' +
        'yourself (see main/rate-limits/opencode-go-request-session.ts) and allowlist it here.'
    ).toEqual([])
    expect(audited).toEqual(AUDITED_SESSION_SCOPED_REQUESTS)
  })

  it('keeps the proxy-login adapter exclusively behind the default-session host client', () => {
    const callers = sources.filter(
      ({ file, content }) =>
        file !== 'main/host/electron-proxy-login-fetch.ts' &&
        /\bfetchWithProxyLogin\b/.test(content)
    )
    expect(callers.map(({ file }) => file)).toEqual(['main/host/electron-http-client.ts'])
    expect(callers[0]?.content).toMatch(/const proxySession = session\.defaultSession/)
    expect(callers[0]?.content).toMatch(/await hasConfiguredProxyCredentials\(proxySession,/)
    expect(callers[0]?.content).toMatch(/getProxySessionApplicationReadiness\(proxySession\)/)
    expect(callers[0]?.content).toMatch(
      /fetchWithProxyLogin\(new Request\(url, init\), proxySession\)/
    )
  })

  it('keeps every non-default-session fetcher audited with its expected count', () => {
    const found = new Map<string, number>()
    for (const { file, content } of sources) {
      const hits = [...content.matchAll(FETCH_CALL)].filter((match) => {
        const receiver = RECEIVER_IDENTIFIER.exec(content.slice(0, match.index))?.[1]
        // A chained (`session.fromPartition(...).fetch(`) or member (`ctx.session.fetch(`)
        // receiver has no bare trailing identifier, and is never the default session.
        return receiver === undefined || !DEFAULT_SESSION_RECEIVERS.has(receiver)
      }).length
      if (hits > 0) {
        found.set(file, hits)
      }
    }

    const drifted = [...found]
      .filter(([file, count]) => AUDITED_NON_NET_FETCH_CALLS.get(file) !== count)
      .map(([file, count]) => `${file}: found ${count} call(s)`)
      .sort()
    expect(
      drifted,
      'A session.fromPartition(...) session is not covered by ' +
        'installElectronProxyRequestGuard(session.defaultSession), so nothing holds its requests ' +
        'until the proxy lands and startup never applies the proxy to it. Apply the proxy to that ' +
        'session yourself (see main/rate-limits/opencode-go-request-session.ts), then update ' +
        'AUDITED_NON_NET_FETCH_CALLS.'
    ).toEqual([])

    const stale = [...AUDITED_NON_NET_FETCH_CALLS.keys()].filter((file) => !found.has(file)).sort()
    expect(stale, 'Remove audited entries whose .fetch( calls are gone.').toEqual([])
  })
})
