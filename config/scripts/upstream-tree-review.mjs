import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createGit, readCommitJson, SHA_PATTERN, STATE_PATH } from './upstream-sync-checkpoint.mjs'

export const TREE_REVIEW_PATH = 'config/upstream-tree-review.json'
export const PRIVATE_DOCS_REPOSITORY = 'coder-lulu/hive-code-docs'
const protectedPaths = new Set([
  'docs',
  '.gitmodules',
  STATE_PATH,
  TREE_REVIEW_PATH,
  'config/open-source-baseline.json',
  'config/private-document-fingerprints.json',
  'config/upstream-tree-sync-receipt.json',
  'config/upstream-sync-boundary.json',
  'config/upstream-change-priority.json',
  'config/upstream-sync-gates.json',
  'config/upstream-regression-matrix.json',
  'config/scripts/public-baseline.mjs',
  'config/scripts/verify-documentation-governance.mjs',
  'config/scripts/audit-fork-delta.mjs',
  'config/scripts/track-upstream-changes.mjs',
  'config/scripts/run-upstream-sync-gates.mjs',
  '.github/workflows/upstream-sync.yml'
])

export function safeReviewPath(file) {
  return (
    typeof file === 'string' &&
    file.length > 0 &&
    !file.includes('\\') &&
    [...file].every((character) => character.charCodeAt(0) >= 32) &&
    !file.startsWith('/') &&
    !file.includes(':') &&
    file.split('/').every((part) => part && part !== '.' && part !== '..' && part !== '.git')
  )
}

export function reviewFileEntry(git, ref, file) {
  const rows = git(['ls-tree', '-z', ref, '--', file]).split('\0').filter(Boolean)
  if (!rows.length) {
    return null
  }
  if (rows.length !== 1 || rows[0].split('\t')[1] !== file) {
    throw new Error(`Ambiguous review path: ${file}`)
  }
  const [mode, type, sha] = rows[0].slice(0, rows[0].indexOf('\t')).split(' ')
  if (type !== 'blob') {
    throw new Error(`Review paths must be files: ${file}`)
  }
  return { mode, sha }
}

function sameEntry(left, right) {
  return left === null
    ? right === null
    : right !== null &&
        left?.mode === right.mode &&
        left?.sha === right.sha &&
        Object.keys(left).length === 2
}

function validateReviewedLedger({ git, target, range }, row) {
  if (!row.result || row.result.mode !== '100644') {
    throw new Error('Reviewed ledger must be a regular file')
  }
  const before = readCommitJson(git, target, row.path)
  const after = JSON.parse(git(['cat-file', 'blob', row.result.sha]))
  if (
    before.schemaVersion !== 1 ||
    after.schemaVersion !== 1 ||
    !Array.isArray(before.entries) ||
    !Array.isArray(after.entries) ||
    JSON.stringify({ ...before, entries: [] }) !== JSON.stringify({ ...after, entries: [] })
  ) {
    throw new Error('Reviewed ledger metadata must retain its frozen ownership')
  }
  const recorded = new Map()
  for (const entry of after.entries) {
    if (
      !SHA_PATTERN.test(entry.upstreamSha) ||
      !range.upstreamShas.has(entry.upstreamSha) ||
      recorded.has(entry.upstreamSha) ||
      !Array.isArray(entry.dependencies) ||
      entry.dependencies.some((sha) => !SHA_PATTERN.test(sha))
    ) {
      throw new Error('Invalid reviewed ledger identities')
    }
    recorded.set(entry.upstreamSha, entry)
  }
  for (const entry of before.entries) {
    if (
      !range.pendingShas.includes(entry.upstreamSha) &&
      JSON.stringify(recorded.get(entry.upstreamSha)) !== JSON.stringify(entry)
    ) {
      throw new Error(`Reviewed ledger cannot rewrite historical evidence: ${entry.upstreamSha}`)
    }
  }
}

export function loadFrozenTreeReview({ git, target, upstream, base }) {
  const review = readCommitJson(git, target, TREE_REVIEW_PATH, true)
  if (!review || review.upstreamSha !== upstream || review.baseUpstreamSha !== base) {
    return null
  }
  if (
    review.schemaVersion !== 1 ||
    review.kind !== 'frozen-upstream-review' ||
    !SHA_PATTERN.test(review.sourceProductSha) ||
    !Array.isArray(review.resolutions)
  ) {
    throw new Error('Invalid frozen product review')
  }
  git(['merge-base', '--is-ancestor', review.sourceProductSha, target])
  return review
}

export function validatePrivateDocumentationReview({ git, upstream }, docs, paths, shas, review) {
  if (!paths.length && !shas.length) {
    return null
  }
  const proof = review?.documentation
  if (
    !proof ||
    proof.privateRepository !== PRIVATE_DOCS_REPOSITORY ||
    proof.privateCommitSha !== docs.sha ||
    !SHA_PATTERN.test(proof.receiptBlobSha) ||
    proof.authentication !== 'authenticated-private-github-repository' ||
    !Array.isArray(proof.documentationShas) ||
    !Array.isArray(proof.paths) ||
    JSON.stringify([...proof.documentationShas].sort()) !== JSON.stringify([...shas].sort()) ||
    proof.paths.length !== paths.length
  ) {
    throw new Error(
      'Upstream docs changes require authenticated private documentation absorption before content synchronization'
    )
  }
  const seen = new Set()
  for (const row of proof.paths) {
    if (
      !paths.includes(row.path) ||
      seen.has(row.path) ||
      typeof row.reason !== 'string' ||
      !row.reason.trim() ||
      !safeReviewPath(row.privatePath) ||
      (row.privateBlobSha !== null && !SHA_PATTERN.test(row.privateBlobSha)) ||
      (row.upstreamBlobSha !== reviewFileEntry(git, upstream, row.path)?.sha &&
        !(row.upstreamBlobSha === null && reviewFileEntry(git, upstream, row.path) === null))
    ) {
      throw new Error(`Incomplete private documentation coverage: ${row.path}`)
    }
    seen.add(row.path)
  }
  return proof
}

export function applyFrozenTreeReview(ctx, mergedTreeSha, conflictPaths, review) {
  const { git, base, target, upstream, cwd } = ctx
  const resolutions = review?.resolutions ?? []
  const seen = new Set()
  for (const row of resolutions) {
    if (
      !safeReviewPath(row.path) ||
      seen.has(row.path) ||
      protectedPaths.has(row.path) ||
      row.path.startsWith('docs/') ||
      row.path.startsWith('config/scripts/upstream-') ||
      typeof row.reason !== 'string' ||
      !row.reason.trim() ||
      !Array.isArray(row.regressionTests) ||
      !row.regressionTests.length ||
      row.regressionTests.some((test) => typeof test !== 'string' || !test.trim())
    ) {
      throw new Error(`Invalid or protected frozen resolution: ${row.path}`)
    }
    for (const [field, ref] of [
      ['base', base],
      ['product', target],
      ['upstream', upstream]
    ]) {
      if (!sameEntry(row[field], reviewFileEntry(git, ref, row.path))) {
        throw new Error(`Frozen ${field} entry differs for ${row.path}`)
      }
    }
    if (row.result !== null) {
      if (
        !['100644', '100755', '120000'].includes(row.result?.mode) ||
        !SHA_PATTERN.test(row.result?.sha) ||
        Object.keys(row.result).length !== 2
      ) {
        throw new Error(`Invalid reviewed result: ${row.path}`)
      }
      try {
        if (git(['cat-file', '-t', row.result.sha]).trim() !== 'blob') {
          throw new Error('Not a blob')
        }
      } catch (cause) {
        throw new Error(
          `Reviewed result blob unavailable for ${row.path}; retain the local candidate or its bundle`,
          { cause }
        )
      }
      if (/^<<<<<<< .+$/m.test(git(['cat-file', 'blob', row.result.sha]))) {
        throw new Error(`Unresolved conflict markers in reviewed result: ${row.path}`)
      }
    }
    if (row.path === 'config/upstream-change-ledger.json') {
      validateReviewedLedger(ctx, row)
    }
    seen.add(row.path)
  }
  const missing = conflictPaths.filter((file) => !seen.has(file))
  if (missing.length) {
    const error = new Error(
      'Three-way content conflicts require individual product-boundary review'
    )
    error.details = { base, upstream, target, conflictPaths, missingReviewPaths: missing }
    throw error
  }
  if (!review) {
    return { mergedTreeSha, summary: null }
  }
  const summary = {
    frozenReviewBlobSha: git(['rev-parse', `${target}:${TREE_REVIEW_PATH}`]).trim(),
    conflictPaths,
    resolutionPaths: [...seen]
  }
  if (!resolutions.length) {
    return { mergedTreeSha, summary }
  }
  const directory = resolve(cwd, 'logs/upstream-sync/recomputation')
  mkdirSync(directory, { recursive: true })
  const temporary = mkdtempSync(join(directory, 'index-'))
  if (dirname(temporary) !== directory) {
    throw new Error('Temporary index escaped task logs')
  }
  const indexGit = createGit(cwd, {
    env: { ...process.env, GIT_INDEX_FILE: join(temporary, 'index') }
  })
  try {
    indexGit(['--no-replace-objects', 'read-tree', mergedTreeSha])
    indexGit(
      ['--no-replace-objects', 'update-index', '-z', '--index-info'],
      resolutions
        .map((row) =>
          row.result
            ? `${row.result.mode} ${row.result.sha}\t${row.path}\0`
            : `0 ${'0'.repeat(40)}\t${row.path}\0`
        )
        .join('')
    )
    return { mergedTreeSha: indexGit(['--no-replace-objects', 'write-tree']).trim(), summary }
  } finally {
    rmSync(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}
