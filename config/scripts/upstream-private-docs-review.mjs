import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  createGit,
  readCommitJson,
  resolveAuditRange,
  SHA_PATTERN
} from './upstream-sync-checkpoint.mjs'
import {
  PRIVATE_DOCS_REPOSITORY,
  reviewFileEntry,
  safeReviewPath
} from './upstream-tree-review.mjs'

export const PRIVATE_DOCS_REVIEW_PATH = 'config/upstream-docs-review.json'

function authenticatedGitHub(path) {
  return JSON.parse(
    execFileSync('gh', ['api', path], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
  )
}

export function createPrivateDocumentationProof({
  cwd = process.cwd(),
  privateCwd,
  target,
  upstream,
  github = authenticatedGitHub
}) {
  if (!privateCwd || !SHA_PATTERN.test(target) || !SHA_PATTERN.test(upstream)) {
    throw new Error(
      'Private documentation review requires exact frozen product/upstream SHAs and a private checkout'
    )
  }
  const git = createGit(cwd)
  const privateGit = createGit(privateCwd)
  const range = resolveAuditRange({ git, upstream, stateRef: target })
  const base = range.audit.baseSha
  if (!base) {
    throw new Error('Private review requires a reconciled upstream checkpoint')
  }
  const repository = github(`repos/${PRIVATE_DOCS_REPOSITORY}`)
  if (
    repository.full_name !== PRIVATE_DOCS_REPOSITORY ||
    repository.private !== true ||
    repository.permissions?.push !== true ||
    repository.default_branch !== 'main'
  ) {
    throw new Error('Authenticated private documentation repository and write access are required')
  }
  if (
    privateGit(['status', '--porcelain']).trim() ||
    privateGit(['symbolic-ref', '--short', 'HEAD']).trim() !== 'main' ||
    privateGit(['remote', 'get-url', 'origin']).trim() !==
      `https://github.com/${PRIVATE_DOCS_REPOSITORY}.git`
  ) {
    throw new Error('Private documentation must be clean on its owned main branch')
  }
  const privateCommitSha = privateGit(['--no-replace-objects', 'rev-parse', 'HEAD']).trim()
  if (
    github(`repos/${PRIVATE_DOCS_REPOSITORY}/git/ref/heads/main`).object?.sha !== privateCommitSha
  ) {
    throw new Error('Private documentation must be published before its public pointer')
  }
  const receipt = readCommitJson(privateGit, privateCommitSha, PRIVATE_DOCS_REVIEW_PATH)
  if (
    receipt.schemaVersion !== 1 ||
    receipt.upstream !== 'stablyai/orca' ||
    receipt.baseUpstreamSha !== base ||
    receipt.upstreamSha !== upstream ||
    !Array.isArray(receipt.paths) ||
    !Array.isArray(receipt.documentationShas)
  ) {
    throw new Error('Private documentation checkpoint differs from the frozen upstream interval')
  }
  const paths = git([
    'diff-tree',
    '--no-commit-id',
    '--name-only',
    '-r',
    '-z',
    base,
    upstream,
    '--'
  ])
    .split('\0')
    .filter((path) => path === '.gitmodules' || path === 'docs' || path.startsWith('docs/'))
  const documentationShas = git([
    'log',
    '--full-history',
    '--format=%H',
    `${base}..${upstream}`,
    '--',
    'docs',
    '.gitmodules'
  ])
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (
    receipt.paths.length !== paths.length ||
    JSON.stringify([...receipt.documentationShas].sort()) !==
      JSON.stringify([...documentationShas].sort())
  ) {
    throw new Error(
      'Private documentation checkpoint does not cover the complete interval, including reverted changes'
    )
  }
  const seen = new Set()
  for (const row of receipt.paths) {
    const source = reviewFileEntry(git, upstream, row.path)
    if (
      !paths.includes(row.path) ||
      seen.has(row.path) ||
      !safeReviewPath(row.privatePath) ||
      typeof row.reason !== 'string' ||
      !row.reason.trim() ||
      row.upstreamBlobSha !== (source?.sha ?? null) ||
      row.privateBlobSha !==
        (reviewFileEntry(privateGit, privateCommitSha, row.privatePath)?.sha ?? null)
    ) {
      throw new Error(`Private documentation file coverage differs: ${row.path}`)
    }
    seen.add(row.path)
  }
  return {
    privateRepository: PRIVATE_DOCS_REPOSITORY,
    privateCommitSha,
    receiptBlobSha: privateGit([
      'rev-parse',
      `${privateCommitSha}:${PRIVATE_DOCS_REVIEW_PATH}`
    ]).trim(),
    authentication: 'authenticated-private-github-repository',
    documentationShas,
    paths: receipt.paths
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    const names = {
      '--cwd': 'cwd',
      '--private-cwd': 'privateCwd',
      '--target': 'target',
      '--upstream': 'upstream',
      '--output': 'output'
    }
    const options = {}
    const args = process.argv.slice(2)
    for (let index = 0; index < args.length; index += 2) {
      if (!names[args[index]] || !args[index + 1] || args[index + 1].startsWith('--')) {
        throw new Error('Invalid private review arguments')
      }
      options[names[args[index]]] = args[index + 1]
    }
    if (!options.output) {
      throw new Error('--output is required for the authenticated public attestation')
    }
    const proof = createPrivateDocumentationProof(options)
    mkdirSync(dirname(resolve(options.output)), { recursive: true })
    writeFileSync(options.output, `${JSON.stringify(proof, null, 2)}\n`)
    process.stdout.write(
      `Authenticated private documentation coverage: ${proof.paths.length} paths, ${proof.documentationShas.length} commits\n`
    )
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
