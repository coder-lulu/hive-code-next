import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { classifySyncBoundaryPath } from './audit-fork-delta.mjs'
import { classifyUpstreamChange, loadPriorityManifest } from './track-upstream-changes.mjs'
import { collectCommitHistory, collectPatchIds } from './upstream-intake-history.mjs'
import { collectImportedAdaptations, readPublicBaseline } from './public-baseline.mjs'
import { verifyUpstreamTreeSync } from './upstream-tree-sync.mjs'
import {
  commitSet,
  createGit,
  readCommitJson,
  requireBoundaryReview,
  resolveAuditRange,
  resolveCommit,
  SHA_PATTERN,
  writeCheckpoint
} from './upstream-sync-checkpoint.mjs'

const PENDING = new Set(['暂缓', '需要产品决定'])
const EXCLUDED = '不吸收'
const FIX_SUBJECT =
  /\b(?:fix(?:es|ed)?|bug|crash|prevent|deny|guard|security|vulnerab\w*|corrupt\w*|regression|recover\w*|restore|stability|data.loss)\b/i

function classifyType(commit, entry, priority) {
  if (priority.priority === 1 || entry?.type === '安全') {
    return 'security'
  }
  if (entry?.type === 'BUG' || FIX_SUBJECT.test(commit.subject)) {
    return 'fix'
  }
  if (
    ['新功能', 'UI'].includes(entry?.type) ||
    /\b(?:feat|add|allow|support|enable|display|ui|theme|layout)\b/i.test(commit.subject)
  ) {
    return 'feature'
  }
  return 'maintenance'
}

function reviewedAdaptation(entry, headCommits, importedAdaptations) {
  const reason = entry?.reviewReason ?? entry?.adaptation
  if (
    !['已移植', '已等价实现'].includes(entry?.applied) ||
    !SHA_PATTERN.test(entry.productSha) ||
    (!headCommits.has(entry.productSha) && !importedAdaptations.has(entry.upstreamSha)) ||
    typeof reason !== 'string' ||
    !reason.trim() ||
    !Array.isArray(entry.regressionTests) ||
    !entry.regressionTests.length ||
    entry.regressionTests.some((test) => typeof test !== 'string' || !test.trim())
  ) {
    return null
  }
  return {
    kind: headCommits.has(entry.productSha)
      ? 'reviewed-adaptation'
      : 'archived-reviewed-adaptation',
    productSha: entry.productSha,
    reason,
    regressionTests: entry.regressionTests
  }
}

function reviewedExclusion(commit, entry) {
  const explicitBoundary =
    commit.boundaryPaths.some((item) => item.classification === 'productBoundary') ||
    ['persisted-contract', 'wire-contract', 'maintained-capability'].includes(
      entry?.boundaryConflict
    )
  const reason = entry?.reviewReason ?? entry?.conflictReason
  if (
    entry?.applied !== EXCLUDED ||
    commit.type !== 'feature' ||
    !explicitBoundary ||
    typeof reason !== 'string' ||
    !reason.trim() ||
    reason === '无' ||
    !Array.isArray(entry.regressionTests) ||
    !entry.regressionTests.length ||
    entry.regressionTests.some((test) => typeof test !== 'string' || !test.trim())
  ) {
    return null
  }
  return {
    kind: 'product-exclusion',
    boundaryConflict: entry.boundaryConflict ?? 'product-path',
    reason,
    regressionTests: entry.regressionTests
  }
}

function disposition(commit, entry, context) {
  const { headCommits, patchIds, productPatches, importedAdaptations, treeAbsorbed, treeCommit } =
    context
  if (entry?.applied === EXCLUDED) {
    const exclusion = reviewedExclusion(commit, entry)
    return exclusion
      ? { disposition: 'excluded', reason: exclusion.reason, evidence: exclusion }
      : {
          disposition: 'unresolved',
          reason:
            'Only an optional feature at an explicit product boundary can be excluded with a reason and regression evidence',
          evidence: null
        }
  }
  if (PENDING.has(entry?.applied)) {
    const explicitBoundary =
      commit.boundaryPaths.some((item) => item.classification === 'productBoundary') ||
      ['persisted-contract', 'wire-contract', 'maintained-capability'].includes(
        entry.boundaryConflict
      )
    const reason = entry.reviewReason ?? entry.conflictReason
    if (
      commit.type === 'feature' &&
      explicitBoundary &&
      typeof reason === 'string' &&
      reason.trim() &&
      reason !== '无'
    ) {
      return {
        disposition: 'deferred',
        reason,
        evidence: {
          kind: 'product-decision',
          boundaryConflict: entry.boundaryConflict ?? 'product-path'
        }
      }
    }
    return {
      disposition: 'unresolved',
      reason: 'A required fix or change without an explicit feature boundary cannot be deferred',
      evidence: null
    }
  }
  if (headCommits.has(commit.sha)) {
    return {
      disposition: 'absorbed',
      reason: 'Commit is reachable; behavior and product adaptation still require review',
      evidence: { kind: 'git-ancestry', productSha: commit.sha, scope: 'history inclusion only' }
    }
  }
  if (treeAbsorbed.has(commit.sha)) {
    return {
      disposition: 'absorbed',
      reason:
        'Frozen three-way content merge was independently recomputed; behavior and boundary review remain required',
      evidence: {
        kind: 'verified-tree-absorption',
        productSha: treeCommit,
        scope: 'content inclusion only'
      }
    }
  }
  const patchId = patchIds.get(commit.sha)
  const productSha = patchId && productPatches.get(patchId)
  if (productSha) {
    return {
      disposition: 'equivalent',
      reason: 'Non-empty stable patch matches a reachable product commit',
      evidence: { kind: 'stable-patch-id', patchId, productSha, scope: 'patch inclusion only' }
    }
  }
  const adaptation = reviewedAdaptation(entry, headCommits, importedAdaptations)
  if (adaptation) {
    return { disposition: 'equivalent', reason: adaptation.reason, evidence: adaptation }
  }
  return {
    disposition: 'unresolved',
    reason:
      'No reachable commit, non-empty matching patch, or reviewed adaptation proves inclusion',
    evidence: null
  }
}

function dependencyClosure(commits, headCommits, reviewedShas) {
  const accepted = new Set([...headCommits, ...reviewedShas])
  for (const row of commits) {
    if (row.disposition === 'absorbed' || row.disposition === 'equivalent') {
      accepted.add(row.sha)
    } else {
      accepted.delete(row.sha)
    }
  }
  const missing = (row) => [
    ...new Set([
      ...row.parents.filter((sha) => !headCommits.has(sha) && !accepted.has(sha)),
      ...row.declaredDependencies.filter((sha) => !accepted.has(sha))
    ])
  ]
  const dependants = new Map()
  const rejected = new Set()
  for (const row of commits) {
    for (const dependency of [
      ...row.parents.filter((sha) => !headCommits.has(sha)),
      ...row.declaredDependencies
    ]) {
      if (!dependants.has(dependency)) {
        dependants.set(dependency, [])
      }
      dependants.get(dependency).push(row.sha)
    }
    if (accepted.has(row.sha) && missing(row).length) {
      rejected.add(row.sha)
    }
  }
  for (const sha of rejected) {
    accepted.delete(sha)
    for (const dependant of dependants.get(sha) ?? []) {
      if (accepted.has(dependant)) {
        rejected.add(dependant)
      }
    }
  }
  for (const row of commits) {
    row.unresolvedDependencies = missing(row)
  }
}

export async function collectIntakeReport({
  upstream,
  head = 'HEAD',
  stateRef,
  targetBranch = 'hivecode/main-next',
  cwd = process.cwd()
}) {
  const git = createGit(cwd)
  const range = resolveAuditRange({ git, upstream, stateRef, targetBranch })
  const headSha = resolveCommit(git, head)
  const headCommits = commitSet(git, headSha)
  if (!headCommits.has(range.stateRef)) {
    throw new Error('Candidate does not contain the frozen product state commit')
  }
  const importedAdaptations = collectImportedAdaptations({ git, head: headSha })
  const publicBaseline = readPublicBaseline({ git, head: range.stateRef })
  const treeProof = publicBaseline
    ? verifyUpstreamTreeSync({
        cwd,
        target: range.stateRef,
        upstream: range.upstreamSha,
        head: headSha,
        targetBranch
      })
    : null
  const treeAbsorbed = new Set(treeProof?.absorbedUpstreamShas ?? [])
  const ledger = readCommitJson(git, headSha, 'config/upstream-change-ledger.json')
  if (ledger.schemaVersion !== 1 || !Array.isArray(ledger.entries)) {
    throw new Error('Invalid upstream change ledger')
  }
  const known = new Map()
  for (const entry of ledger.entries) {
    if (
      !SHA_PATTERN.test(entry.upstreamSha) ||
      !range.upstreamShas.has(entry.upstreamSha) ||
      known.has(entry.upstreamSha) ||
      !Array.isArray(entry.dependencies) ||
      entry.dependencies.some((sha) => !SHA_PATTERN.test(sha))
    ) {
      throw new Error(
        'Ledger contains unknown upstream commits, duplicate commits or invalid dependency identities'
      )
    }
    known.set(entry.upstreamSha, entry)
  }
  const history = collectCommitHistory(git, range.selectedShas)
  const missing = history.filter(
    (commit) => !headCommits.has(commit.sha) && commit.parents.length < 2
  )
  const patchIds = await collectPatchIds(
    cwd,
    missing.map((commit) => commit.sha)
  )
  const productOnly = missing.length ? [...commitSet(git, headSha, '--not', range.upstreamSha)] : []
  const productPatches = new Map(
    [...(await collectPatchIds(cwd, productOnly))].map(([sha, patchId]) => [patchId, sha])
  )
  const manifest = loadPriorityManifest()
  const carriedPending = new Set(range.pendingShas)
  const commits = history.map((commit) => {
    const entry = known.get(commit.sha)
    const priority = classifyUpstreamChange({ ...commit, manifest })
    const row = {
      ...commit,
      ...priority,
      type: classifyType(commit, entry, priority),
      boundaryPaths: commit.paths.map((filePath) => ({
        path: filePath,
        classification: classifySyncBoundaryPath(filePath) ?? 'manualReview'
      })),
      dependencies: [...new Set([...commit.parents, ...(entry?.dependencies ?? [])])],
      declaredDependencies: entry?.dependencies ?? [],
      review: entry
        ? {
            applied: entry.applied,
            reason: entry.reviewReason ?? entry.adaptation ?? entry.conflictReason,
            regressionTests: entry.regressionTests ?? []
          }
        : null
    }
    const resolutionReason = entry?.reviewReason ?? entry?.adaptation
    const explicitResolution =
      ['已移植', '已等价实现', EXCLUDED].includes(entry?.applied) &&
      typeof resolutionReason === 'string' &&
      resolutionReason.trim()
    const decision =
      carriedPending.has(commit.sha) && !PENDING.has(entry?.applied) && !explicitResolution
        ? {
            disposition: 'unresolved',
            reason:
              'Previously pending decision lacks an explicit reviewed resolution in the ledger',
            evidence: null
          }
        : disposition(row, entry, {
            headCommits,
            patchIds,
            productPatches,
            importedAdaptations,
            treeAbsorbed,
            treeCommit: treeProof?.contentCommitSha
          })
    return { ...row, ...decision }
  })
  dependencyClosure(commits, headCommits, range.reviewedShas)
  const blockers = []
  for (const row of commits) {
    if (row.disposition === 'unresolved') {
      blockers.push({ sha: row.sha, code: 'missing-inclusion', message: row.reason })
    }
    if (row.disposition !== 'deferred' && row.unresolvedDependencies.length) {
      blockers.push({
        sha: row.sha,
        code: 'dependency-closure',
        message: 'Required dependency has not been absorbed or proven equivalent',
        dependencies: row.unresolvedDependencies
      })
    }
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    upstreamSha: range.upstreamSha,
    headSha,
    stateRef: range.stateRef,
    targetBranch,
    audit: range.audit,
    reviewStatus:
      'Inclusion audit only; exact-candidate gates and fork-delta boundary review remain required before product publication',
    passed: blockers.length === 0,
    counts: Object.fromEntries(
      ['absorbed', 'equivalent', 'excluded', 'deferred', 'unresolved'].map((name) => [
        name,
        commits.filter((row) => row.disposition === name).length
      ])
    ),
    commits,
    pendingShas: commits.filter((row) => row.disposition === 'deferred').map((row) => row.sha),
    blockers
  }
}

export function renderIntakeMarkdown(report) {
  const lines = [
    '# Upstream intake report',
    '',
    `- Upstream: ${report.upstreamSha}`,
    `- Candidate: ${report.headSha}`,
    `- Product state: ${report.stateRef}`,
    `- Audit: ${report.audit.mode}; base: ${report.audit.baseSha ?? 'complete reachable history'}`,
    `- Inclusion gate: ${report.passed ? 'passed' : 'failed'}`,
    `- Review: ${report.reviewStatus ?? 'Preflight failed'}`,
    '',
    '## Blockers',
    ''
  ]
  for (const blocker of report.blockers) {
    lines.push(`- ${blocker.sha ?? 'preflight'}: ${blocker.message}`)
  }
  if (!report.blockers.length) {
    lines.push('- none')
  }
  lines.push('', '## Commit decisions', '')
  for (const row of report.commits) {
    lines.push(
      `- \`${row.sha}\` [P${row.priority}/${row.type}/${row.disposition}] ${row.subject}`,
      `  - Reason: ${row.reason}`,
      `  - Evidence: ${JSON.stringify(row.evidence)}`,
      `  - Boundaries: ${row.boundaryPaths.map((item) => `${item.classification}:${item.path}`).join(', ') || 'none'}`,
      `  - Parents: ${row.parents.join(', ') || 'none'}`,
      `  - Unresolved dependencies: ${row.unresolvedDependencies.join(', ') || 'none'}`
    )
  }
  return `${lines.join('\n')}\n`
}

function parseArgs(argv) {
  const options = {
    upstream: 'upstream/main',
    head: 'HEAD',
    report: 'logs/upstream-sync/upstream-intake-report.md'
  }
  const names = {
    '--upstream': 'upstream',
    '--head': 'head',
    '--state-ref': 'stateRef',
    '--target-branch': 'targetBranch',
    '--report': 'report',
    '--json-output': 'jsonOutput',
    '--cwd': 'cwd'
  }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--write-checkpoint') {
      options.writeCheckpoint = true
    } else if (arg === '--require-boundary-review') {
      options.requireBoundaryReview = true
    } else if (names[arg] && argv[index + 1] && !argv[index + 1].startsWith('--')) {
      options[names[arg]] = argv[++index]
    } else {
      throw new Error(`Unknown argument or missing value: ${arg}`)
    }
  }
  return options
}

function writeReport(filePath, contents) {
  const resolved = path.resolve(filePath)
  mkdirSync(path.dirname(resolved), { recursive: true })
  writeFileSync(resolved, contents)
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    const options = parseArgs(process.argv.slice(2))
    let report
    try {
      report = await collectIntakeReport(options)
    } catch (error) {
      report = {
        schemaVersion: 1,
        upstreamSha: options.upstream,
        headSha: options.head,
        stateRef: options.stateRef,
        audit: { mode: 'invalid', baseSha: null },
        passed: false,
        counts: {},
        commits: [],
        pendingShas: [],
        blockers: [{ code: 'preflight', message: error.message }]
      }
    }
    if (options.requireBoundaryReview && report.passed) {
      try {
        requireBoundaryReview(report)
      } catch (error) {
        report.passed = false
        report.blockers.push({ code: 'boundary-review', message: error.message })
      }
    }
    writeReport(options.report, renderIntakeMarkdown(report))
    if (options.jsonOutput) {
      writeReport(options.jsonOutput, `${JSON.stringify(report, null, 2)}\n`)
    }
    if (options.writeCheckpoint && report.passed) {
      writeCheckpoint(report, options.cwd)
    }
    process.stdout.write(
      `Upstream ${report.audit.mode} audit: ${report.commits.length} commits, ${report.blockers.length} blockers\n`
    )
    if (!report.passed) {
      process.exitCode = 1
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
