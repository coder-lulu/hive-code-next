import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

export const STATE_PATH = 'config/upstream-sync-state.json'
export const UPSTREAM_REPOSITORY = 'stablyai/orca'
export const SHA_PATTERN = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/

export function createGit(cwd = process.cwd()) {
  return (args, input) =>
    execFileSync('git', args, {
      cwd,
      input,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 128 * 1024 * 1024
    })
}

export function resolveCommit(git, ref) {
  const sha = git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim()
  if (!SHA_PATTERN.test(sha)) {
    throw new Error(`Invalid commit: ${ref}`)
  }
  return sha
}

export function readCommitJson(git, sha, filePath, optional = false) {
  if (!git(['ls-tree', sha, '--', filePath]).trim()) {
    if (optional) {
      return null
    }
    throw new Error(`Missing ${filePath} in ${sha}`)
  }
  return JSON.parse(git(['show', `${sha}:${filePath}`]))
}

export function commitSet(git, ...revisions) {
  return new Set(
    git(['rev-list', ...revisions, '--'])
      .trim()
      .split(/\s+/)
      .filter(Boolean)
  )
}

export function resolveAuditRange({
  git = createGit(),
  upstream,
  stateRef,
  targetBranch = 'hivecode/main-next'
}) {
  if (!['hivecode/main-next', 'main'].includes(targetBranch)) {
    throw new Error('Unsupported product target')
  }
  if (!stateRef) {
    throw new Error('--state-ref must identify the frozen product commit')
  }
  const upstreamSha = resolveCommit(git, upstream)
  const productSha = resolveCommit(git, stateRef)
  const state = readCommitJson(git, productSha, STATE_PATH, true)
  const reachable = commitSet(git, upstreamSha)
  let baseSha = null
  let pendingShas = []
  if (state !== null) {
    if (
      state.schemaVersion !== 1 ||
      typeof state.initialAuditCompleted !== 'boolean' ||
      state.upstream !== UPSTREAM_REPOSITORY ||
      state.targetBranch !== targetBranch ||
      !Array.isArray(state.pendingShas)
    ) {
      throw new Error('Invalid or differently owned upstream checkpoint in product commit')
    }
    pendingShas = [...new Set(state.pendingShas)]
    if (pendingShas.some((sha) => !SHA_PATTERN.test(sha) || !reachable.has(sha))) {
      throw new Error('Checkpoint pending commit is missing from frozen upstream history')
    }
    if (state.initialAuditCompleted) {
      baseSha = state.lastReviewedUpstreamSha
      if (!SHA_PATTERN.test(baseSha) || !reachable.has(baseSha)) {
        throw new Error(
          'Upstream history was rewritten or the reviewed checkpoint is invalid; reconcile explicitly'
        )
      }
    } else if (state.lastReviewedUpstreamSha !== null || pendingShas.length) {
      throw new Error('Incomplete initial audit cannot supply a cursor or pending commits')
    }
  }
  const reviewed = baseSha ? commitSet(git, baseSha) : new Set()
  const selected = new Set([...reachable].filter((sha) => !reviewed.has(sha)))
  for (const sha of pendingShas) {
    selected.add(sha)
    reviewed.delete(sha)
  }
  return {
    upstreamSha,
    stateRef: productSha,
    targetBranch,
    pendingShas,
    audit: { mode: baseSha ? 'incremental' : 'full', baseSha },
    selectedShas: [...selected],
    upstreamShas: reachable,
    reviewedShas: reviewed
  }
}

export function writeCheckpoint(report, cwd = process.cwd(), git = createGit(cwd)) {
  if (!report.passed) {
    throw new Error('Refusing to advance a failed upstream audit')
  }
  let branch = null
  try {
    branch = git(['symbolic-ref', '--quiet', '--short', 'HEAD']).trim()
  } catch (error) {
    if (error.status !== 1) {
      throw error
    }
  }
  if (['hivecode/main-next', 'main'].includes(branch)) {
    throw new Error(
      'Checkpoint must be proposed from a candidate checkout, not written on the product branch'
    )
  }
  if (resolveCommit(git, 'HEAD') !== report.headSha) {
    throw new Error('Checkpoint checkout is not the audited head')
  }
  const previous = readCommitJson(git, report.stateRef, STATE_PATH, true)
  if (
    previous?.initialAuditCompleted &&
    previous.lastReviewedUpstreamSha === report.upstreamSha &&
    previous.pendingShas.length === report.pendingShas.length &&
    previous.pendingShas.every((sha) => report.pendingShas.includes(sha))
  ) {
    writeFileSync(path.join(cwd, STATE_PATH), git(['show', `${report.stateRef}:${STATE_PATH}`]))
    return
  }
  const state = {
    schemaVersion: 1,
    upstream: UPSTREAM_REPOSITORY,
    targetBranch: report.targetBranch,
    initialAuditCompleted: true,
    lastReviewedUpstreamSha: report.upstreamSha,
    pendingShas: report.pendingShas,
    lastAudit: {
      mode: report.audit.mode,
      baseSha: report.audit.baseSha,
      inclusionHeadSha: report.headSha,
      productSha: report.stateRef,
      commitCount: report.commits.length,
      generatedAt: report.generatedAt,
      activation: 'Only after gates and human review merge this record into the product branch'
    }
  }
  writeFileSync(path.join(cwd, STATE_PATH), `${JSON.stringify(state, null, 2)}\n`)
}
