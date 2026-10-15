import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import {
  createGit,
  readCommitJson,
  requireBoundaryReview,
  STATE_PATH
} from './upstream-sync-checkpoint.mjs'
import { verifyUpstreamTreeSync } from './upstream-tree-sync.mjs'
import { collectIntakeReport, renderIntakeMarkdown } from './upstream-intake.mjs'
import { verifyFrozenProductTip } from './upstream-sync-preflight.mjs'

// GitHub documents a 100 MB Git blob limit, not retention for unreachable objects.
// The blob is a short-lived handoff; upload-artifact owns the successful run's evidence.
export const MAX_BUNDLE_BYTES = 100_000_000
const shaPattern = /^[a-f0-9]{40}$/
const repositoryPattern = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/
const allowedBranches = ['main', 'hivecode/main-next']

function requireValue(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

export function parseBundleInputs(env = process.env) {
  const keys = [
    'BUNDLE_BLOB_SHA',
    'EXPECTED_TARGET_SHA',
    'EXPECTED_UPSTREAM_SHA',
    'EXPECTED_CANDIDATE_SHA'
  ]
  const values = keys.map((key) => env[key] ?? '')
  requireValue(allowedBranches.includes(env.TARGET_BRANCH), 'Invalid product target branch')
  requireValue(
    repositoryPattern.test(env.GITHUB_REPOSITORY ?? '') && !/\s/.test(env.GITHUB_REPOSITORY ?? ''),
    'Invalid product repository'
  )
  if (values.every((value) => value === '')) {
    return null
  }
  requireValue(
    values.every((value) => value !== ''),
    'Bundle mode requires all four SHA inputs'
  )
  requireValue(
    values.every((value) => value.length === 40 && shaPattern.test(value)),
    'Bundle inputs require exact lowercase SHA-1 identities'
  )
  const [bundleBlobSha, target, upstream, candidate] = values
  requireValue(candidate !== target, 'Bundle candidate must advance the frozen target')
  return {
    bundleBlobSha,
    target,
    upstream,
    candidate,
    targetBranch: env.TARGET_BRANCH,
    repository: env.GITHUB_REPOSITORY
  }
}

function validateInput(input) {
  const parsed = parseBundleInputs({
    BUNDLE_BLOB_SHA: input.bundleBlobSha,
    EXPECTED_TARGET_SHA: input.target,
    EXPECTED_UPSTREAM_SHA: input.upstream,
    EXPECTED_CANDIDATE_SHA: input.candidate,
    TARGET_BRANCH: input.targetBranch,
    GITHUB_REPOSITORY: input.repository
  })
  requireValue(parsed, 'Bundle mode requires all four SHA inputs')
  return parsed
}

export async function downloadBundleBlob(input, { token, fetchImpl = fetch } = {}) {
  validateInput(input)
  const response = await fetchImpl(
    `https://api.github.com/repos/${input.repository}/git/blobs/${input.bundleBlobSha}`,
    {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(120_000),
      headers: {
        Accept: 'application/vnd.github.raw+json',
        'Accept-Encoding': 'identity',
        'X-GitHub-Api-Version': '2026-03-10',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    }
  )
  requireValue(
    response.status === 200,
    `Candidate handoff blob unavailable (HTTP ${response.status}); no retention is promised. Re-upload the same locally retained bundle.`
  )
  const length = response.headers.get('content-length')
  requireValue(
    length === null || (/^\d+$/.test(length) && Number(length) <= MAX_BUNDLE_BYTES),
    'Candidate bundle exceeds 100 MB'
  )
  requireValue(response.body, 'Candidate blob response has no body')
  const chunks = []
  let size = 0
  const reader = response.body.getReader()
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        break
      }
      size += value.byteLength
      requireValue(size <= MAX_BUNDLE_BYTES, 'Candidate bundle exceeds 100 MB')
      chunks.push(Buffer.from(value))
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
  requireValue(
    length === null || Number(length) === size,
    'Candidate blob response length mismatch'
  )
  return Buffer.concat(chunks, size)
}

export function inspectBundle(bytes, input) {
  validateInput(input)
  requireValue(
    Buffer.isBuffer(bytes) && bytes.length <= MAX_BUNDLE_BYTES,
    'Candidate bundle exceeds 100 MB'
  )
  const actual = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
  requireValue(actual === input.bundleBlobSha, 'Candidate Git blob SHA mismatch')
  const headerEnd = bytes.indexOf('\n\n')
  requireValue(headerEnd > 0 && headerEnd <= 64 * 1024, 'Missing or oversized bundle header')
  const header = bytes.subarray(0, headerEnd).toString('utf8')
  requireValue(!header.includes('\r') && !header.includes('\0'), 'Invalid bundle header encoding')
  const [signature, ...lines] = header.split('\n')
  requireValue(
    ['# v2 git bundle', '# v3 git bundle'].includes(signature),
    'Unsupported bundle version'
  )
  if (signature === '# v3 git bundle' && lines[0] === '@object-format=sha1') {
    lines.shift()
  }
  requireValue(lines.length === 2, 'Bundle must have exactly one prerequisite and one ref')
  requireValue(
    new RegExp(`^-${input.target}(?: [^\\r\\n\\0]*)?$`).test(lines[0]),
    'Bundle prerequisite must be the frozen target'
  )
  requireValue(
    lines[1] === `${input.candidate} refs/heads/${input.targetBranch}`,
    'Bundle candidate or ref mismatch'
  )
  requireValue(
    bytes.subarray(headerEnd + 2, headerEnd + 6).toString('ascii') === 'PACK',
    'Missing bundle pack'
  )
  return { candidate: input.candidate, prerequisite: input.target }
}

export function verifyCandidateCheckpoint({ state, previous, report, contentCommitSha }) {
  requireValue(
    report.passed === true && report.blockers?.length === 0,
    'Candidate checkpoint requires closed intake'
  )
  requireBoundaryReview(report)
  requireValue(
    state &&
      state.schemaVersion === 1 &&
      state.upstream === 'stablyai/orca' &&
      state.targetBranch === report.targetBranch &&
      state.initialAuditCompleted === true &&
      state.lastReviewedUpstreamSha === report.upstreamSha &&
      Array.isArray(state.pendingShas) &&
      state.pendingShas.length === new Set(state.pendingShas).size &&
      isDeepStrictEqual([...state.pendingShas].sort(), [...report.pendingShas].sort()),
    'Candidate checkpoint cursor or pending decisions mismatch'
  )
  // The existing writer preserves identical state byte-for-byte when there is no new interval.
  if (previous && isDeepStrictEqual(state, previous)) {
    return
  }
  const generatedAt = state.lastAudit?.generatedAt
  requireValue(
    typeof generatedAt === 'string' &&
      !Number.isNaN(Date.parse(generatedAt)) &&
      new Date(generatedAt).toISOString() === generatedAt,
    'Invalid candidate checkpoint timestamp'
  )
  const expected = {
    schemaVersion: 1,
    upstream: 'stablyai/orca',
    targetBranch: report.targetBranch,
    initialAuditCompleted: true,
    lastReviewedUpstreamSha: report.upstreamSha,
    pendingShas: state.pendingShas,
    lastAudit: {
      mode: report.audit.mode,
      baseSha: report.audit.baseSha,
      inclusionHeadSha: contentCommitSha ?? report.stateRef,
      productSha: report.stateRef,
      commitCount: report.commits.length,
      generatedAt,
      activation:
        'Effective after boundary review, exact-candidate gates and fast-forward product publication'
    }
  }
  requireValue(isDeepStrictEqual(state, expected), 'Candidate checkpoint audit binding mismatch')
}

export function verifyFrozenBundleInputs(input, git) {
  validateInput(input)
  const origin = git(['remote', 'get-url', 'origin']).trim()
  requireValue(
    [
      `https://github.com/${input.repository}`,
      `https://github.com/${input.repository}.git`
    ].includes(origin),
    'Product remote is not this GitHub repository'
  )
  requireValue(
    git(['rev-parse', '--verify', `${input.target}^{commit}`]).trim() === input.target,
    'Frozen target is not a commit'
  )
  requireValue(
    git(['rev-parse', '--verify', `${input.upstream}^{commit}`]).trim() === input.upstream,
    'Frozen upstream is not a commit'
  )
  git(['merge-base', '--is-ancestor', input.upstream, 'refs/remotes/upstream/main'])
  verifyFrozenProductTip({ target: input.target, targetBranch: input.targetBranch, git })
}

/** Imports objects only. No checkout, hooks, candidate scripts or branch publication. */
export function importCandidateBundle(input, file, git) {
  inspectBundle(readFileSync(file), input)
  git(['bundle', 'verify', file])
  git(['fetch', '--no-tags', '--no-recurse-submodules', file, `refs/heads/${input.targetBranch}`])
  requireValue(
    git(['rev-parse', 'FETCH_HEAD']).trim() === input.candidate,
    'Imported candidate SHA mismatch'
  )
  requireValue(
    git(['rev-parse', '--verify', `${input.candidate}^{commit}`]).trim() === input.candidate,
    'Candidate is not a commit'
  )
  git(['merge-base', '--is-ancestor', input.target, input.candidate])
  return input.candidate
}

export function writeCandidateArtifact(input, output, git) {
  validateInput(input)
  const ref = `refs/heads/${input.targetBranch}`
  const originalHead = git(['rev-parse', 'HEAD']).trim()
  const old = git(['show-ref', '--verify', '--hash', ref]).trim()
  requireValue(old === input.target, 'Local product ref moved during preparation')
  // The local ref exists only to name the advertised bundle tip, never a remote branch.
  git(['update-ref', ref, input.candidate, input.target])
  try {
    git(['bundle', 'create', output, ref])
  } finally {
    git(['update-ref', ref, input.target, input.candidate])
  }
  requireValue(
    git(['bundle', 'list-heads', output]).trim() === `${input.candidate} ${ref}`,
    'Artifact candidate SHA or ref mismatch'
  )
  requireValue(
    git(['rev-parse', 'HEAD']).trim() === originalHead,
    'Preparation changed the candidate identity'
  )
}

export async function prepareBundleCandidate({ cwd = process.cwd(), input, token }) {
  validateInput(input)
  const rawGit = createGit(cwd, { timeoutMs: 300_000 })
  const git = (args) => rawGit(['--no-replace-objects', '-c', 'core.hooksPath=/dev/null', ...args])
  verifyFrozenBundleInputs(input, git)
  const originalHead = git(['rev-parse', 'HEAD']).trim()
  requireValue(originalHead === input.target, 'Bundle preparation must start at the frozen target')
  requireValue(
    !git(['status', '--porcelain']).trim() && !git(['ls-files', '-u']).trim(),
    'Bundle preparation requires a clean checkout'
  )
  const directory = resolve(cwd, 'logs/upstream-sync')
  mkdirSync(directory, { recursive: true })
  const file = resolve(directory, 'incoming-candidate.bundle')
  const bytes = await downloadBundleBlob(input, { token })
  inspectBundle(bytes, input)
  writeFileSync(file, bytes, { flag: 'wx' })
  importCandidateBundle(input, file, git)
  const proof = verifyUpstreamTreeSync({
    cwd,
    target: input.target,
    upstream: input.upstream,
    head: input.candidate,
    targetBranch: input.targetBranch
  })
  const report = await collectIntakeReport({
    cwd,
    upstream: input.upstream,
    head: input.candidate,
    stateRef: input.target,
    targetBranch: input.targetBranch
  })
  writeFileSync(resolve(directory, 'proposed-intake.json'), `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(resolve(directory, 'proposed-intake.md'), renderIntakeMarkdown(report))
  verifyCandidateCheckpoint({
    state: readCommitJson(git, input.candidate, STATE_PATH),
    previous: readCommitJson(git, input.target, STATE_PATH, true),
    report,
    contentCommitSha: proof.contentCommitSha
  })
  verifyFrozenBundleInputs(input, git)
  requireValue(
    git(['rev-parse', 'HEAD']).trim() === originalHead,
    'Preparation changed the checkout'
  )
  // Repack complete history for downstream shallow checkouts. The commit is unchanged.
  const output = resolve(directory, 'candidate/candidate.bundle')
  mkdirSync(dirname(output), { recursive: true })
  writeCandidateArtifact(input, output, git)
  return { candidateSha: input.candidate, hasChanges: true }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    requireValue(
      process.argv.length === 2,
      'Bundle input accepts only validated environment inputs'
    )
    const input = parseBundleInputs()
    requireValue(input, 'Bundle mode requires all four SHA inputs')
    const result = await prepareBundleCandidate({
      cwd: process.env.GITHUB_WORKSPACE,
      input,
      token: process.env.GH_TOKEN
    })
    requireValue(process.env.GITHUB_OUTPUT, 'Missing workflow output path')
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `candidate_sha=${result.candidateSha}\nhas_changes=true\n`
    )
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
