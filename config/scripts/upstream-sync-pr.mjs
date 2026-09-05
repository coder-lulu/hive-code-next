import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

function requireValue(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function readReport(directory, name) {
  return JSON.parse(readFileSync(path.join(directory, name), 'utf8'))
}

function text(value) {
  return String(value ?? '')
    .replace(/[\r\n]/g, ' ')
    .replace(/[<>`]/g, '')
}

function list(items, limit = 40) {
  if (items.length === 0) {
    return '- None.'
  }
  const lines = items.slice(0, limit).map((item) => `- ${text(item)}`)
  if (items.length > limit) {
    lines.push(`- ${items.length - limit} more; see the full run artifacts.`)
  }
  return lines.join('\n')
}

export function renderPullRequest(options) {
  const { evidence, upstream, target, vendor, vendorBase, targetBranch, runUrl } = options
  for (const [name, sha] of Object.entries({ upstream, target, vendor, vendorBase })) {
    requireValue(/^[a-f0-9]{40}$/.test(sha ?? ''), `Invalid ${name} SHA`)
  }
  requireValue(
    ['main', 'hivecode/main-next'].includes(targetBranch),
    'Invalid product target branch'
  )
  requireValue(
    /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/actions\/runs\/\d+$/.test(runUrl ?? ''),
    'Invalid workflow run URL'
  )
  const intake = readReport(evidence, 'upstream-intake-report.json')
  const fork = readReport(evidence, 'fork-delta.json')
  const product = readReport(evidence, 'product-delta.json')
  requireValue(intake.schemaVersion === 1, 'Unsupported intake report schema')
  requireValue(intake.passed === true && intake.blockers?.length === 0, 'Intake is not closed')
  requireValue(
    intake.upstreamSha === upstream && intake.headSha === vendor && intake.stateRef === target,
    'Intake report does not match the tested upstream, candidate, and product SHAs'
  )
  requireValue(fork.baseSha === upstream && fork.headSha === vendor, 'Fork delta SHA mismatch')
  requireValue(
    product.baseSha === target && product.headSha === vendor,
    'Product delta SHA mismatch'
  )
  requireValue(['full', 'incremental'].includes(intake.audit?.mode), 'Missing audit mode')
  requireValue(
    intake.audit.mode === 'full' || /^[a-f0-9]{40}$/.test(intake.audit.baseSha ?? ''),
    'Missing incremental audit base'
  )
  requireValue(
    Array.isArray(intake.commits) && Array.isArray(intake.pendingShas),
    'Missing intake decisions'
  )
  for (const filename of [
    'fork-delta.md',
    'product-delta.md',
    'upstream-change-intake.md',
    'upstream-intake-report.md'
  ]) {
    requireValue(
      readFileSync(path.join(evidence, filename), 'utf8').trim().length > 0,
      `Empty report: ${filename}`
    )
  }
  const gates = ['common-gates', 'regression-linux', 'regression-darwin', 'regression-win32'].map(
    (name) => {
      const report = readReport(evidence, `${name}.json`)
      requireValue(
        report.status === 'success' &&
          report.vendorSha === vendor &&
          report.targetSha === target &&
          report.upstreamSha === upstream,
        `Missing, failed, or stale gate evidence: ${name}`
      )
      requireValue(report.suite === name, `Unexpected gate suite: ${name}`)
      requireValue(
        Array.isArray(report.commands) && report.commands.length > 0,
        `Missing commands: ${name}`
      )
      return `- ${name}: passed — ${report.commands.map(text).join('; ')}`
    }
  )
  const pending = new Set(intake.pendingShas)
  const decisions = intake.commits.filter(
    (commit) => pending.has(commit.sha) || commit.boundaryPaths?.length
  )
  const decisionLines = decisions.map(
    (commit) =>
      `${commit.sha} ${commit.subject}: ${commit.disposition}; ${commit.reason || 'see intake evidence'}`
  )
  const boundaryLines = [
    ...(product.productBoundaryFiles ?? []).map((item) => `${item} — product maintainer review`),
    ...(product.manualReviewFiles ?? []).map((item) => `${item} — compatibility owner review`),
    ...(product.directAbsorbFiles ?? []).map(
      (item) => `${item} — direct absorption; preserve contracts`
    )
  ]
  const classifiedPaths = new Set([
    ...(product.productBoundaryFiles ?? []),
    ...(product.manualReviewFiles ?? []),
    ...(product.directAbsorbFiles ?? [])
  ])
  for (const filePath of new Set(
    (product.changedFiles ?? []).flatMap((file) => [file.path, file.oldPath].filter(Boolean))
  )) {
    if (!classifiedPaths.has(filePath)) {
      boundaryLines.push(`${filePath} — unclassified; maintainer review required`)
    }
  }
  const auditRange =
    intake.audit.mode === 'full'
      ? `Complete reachable upstream history through ${upstream}`
      : `${intake.audit.baseSha}..${upstream}, plus unresolved carry-over`
  return `## Upstream update awaiting review

Absorb upstream fixes and non-duplicate features while preserving HiveCode behavior and compatibility. No visual change is asserted by this automation; reviewers must inspect any UI changes listed in the reports.

- Source: stablyai/orca@${upstream}
- Product target: ${targetBranch}@${target}
- Tested vendor-integration candidate: ${vendor}
- Previous remote vendor tip: ${vendorBase}
- Merge conflicts: none
- Audit: ${intake.audit.mode}; ${auditRange}
- Intake counts: ${text(JSON.stringify(intake.counts))}
- Pending boundary decisions carried into the next review: ${intake.pendingShas.length}

## Required review

${intake.audit.mode === 'full' ? 'Review the complete historical intake report in this PR. ' : 'Review this increment and every pending boundary decision. '}Ancestry and patch equivalence are inclusion evidence; they do not prove behavior, security, or compatibility. The checkpoint in this candidate is proposed only: it becomes effective after these exact changes pass verification and this PR is reviewed and merged into the product target. Do not advance the checkpoint separately.

Product maintainers must approve product-boundary changes; compatibility owners must approve manual-review paths. Keep HiveCode identity, endpoints, update policy, persisted/wire identifiers, and existing UI capabilities. Upstream skill-sharing implementation remains reference-only and requires its separate license and security review.

## Boundary paths changed against the product target

${list(boundaryLines)}

## Intake decisions and unresolved follow-up

${list(decisionLines)}

${pending.size ? `Pending SHAs: ${[...pending].slice(0, 40).map(text).join(', ')}${pending.size > 40 ? `; ${pending.size - 40} more in the full intake artifact` : ''}` : 'No deferred boundary features remain in this intake.'}

## Verification

${gates.join('\n')}

All evidence above is bound to the exact upstream, product, and candidate SHAs. Platform contracts cover Linux, macOS, and Windows; they do not claim real-device, hardware-signing, or exhaustive performance validation. Any product or vendor tip movement invalidates this evidence.

## Reports and risk review

[Workflow run and downloadable evidence](${runUrl}) include fork-delta.md/json, product-delta.md/json, upstream-change-intake.md, upstream-intake-report.md/json, common verification, and all three platform logs/results. Large path and decision lists above are abbreviated only in this PR body; the artifacts contain the full lists.

Before approval, review cross-platform, SSH/remote/local, agent/integration, persistence, performance, and security implications in those reports, plus UI behavior when changed. This workflow proposes the PR and never merges into ${targetBranch} automatically.
`
}

export function parseArgs(argv) {
  const options = {}
  const names = new Map(
    [
      'evidence',
      'upstream',
      'target',
      'vendor',
      'vendor-base',
      'target-branch',
      'run-url',
      'output'
    ].map((name) => [
      `--${name}`,
      name.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())
    ])
  )
  for (let index = 0; index < argv.length; index += 2) {
    const key = names.get(argv[index])
    const value = argv[index + 1]
    requireValue(key && value && !value.startsWith('--'), `Invalid argument: ${argv[index]}`)
    options[key] = value
  }
  for (const key of names.values()) {
    requireValue(options[key], `Missing ${key}`)
  }
  return options
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    const options = parseArgs(process.argv.slice(2))
    writeFileSync(options.output, renderPullRequest(options), 'utf8')
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
