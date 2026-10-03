import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  createGit,
  readCommitJson,
  resolveAuditRange,
  resolveCommit,
  SHA_PATTERN,
  STATE_PATH
} from './upstream-sync-checkpoint.mjs'

export const TREE_SYNC_RECEIPT_PATH = 'config/upstream-tree-sync-receipt.json'
const receiptName = TREE_SYNC_RECEIPT_PATH.split('/').at(-1)

function context(options) {
  const cwd = options.cwd ?? process.cwd()
  const raw = createGit(cwd)
  const git = (args, input) => raw(['--no-replace-objects', ...args], input)
  for (const sha of [options.target, options.upstream]) {
    if (!SHA_PATTERN.test(sha)) {
      throw new Error('Tree sync requires exact frozen target and upstream SHAs')
    }
  }
  const state = readCommitJson(git, options.target, STATE_PATH)
  const range = resolveAuditRange({
    git,
    upstream: options.upstream,
    stateRef: options.target,
    targetBranch: options.targetBranch ?? state.targetBranch
  })
  if (!range.audit.baseSha) {
    throw new Error('Tree sync requires an explicitly reconciled historical upstream checkpoint')
  }
  const grafts = git(['rev-parse', '--git-path', 'info/grafts']).trim()
  try {
    if (readFileSync(resolve(cwd, grafts), 'utf8').trim()) {
      throw new Error('Legacy Git grafts must be removed before frozen tree verification')
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error
    }
  }
  if (git(['for-each-ref', '--format=%(refname)', 'refs/replace/']).trim()) {
    throw new Error('Git replacement refs are not allowed during frozen tree verification')
  }
  return {
    git,
    range,
    target: options.target,
    upstream: options.upstream,
    base: range.audit.baseSha
  }
}

function entries(git, tree) {
  return git(['ls-tree', '-z', tree])
    .split('\0')
    .filter(Boolean)
    .map((record) => {
      const tab = record.indexOf('\t')
      const [mode, type, sha] = record.slice(0, tab).split(' ')
      return { mode, type, sha, name: record.slice(tab + 1) }
    })
}

function tree(git, rows) {
  return git(
    ['mktree', '--missing', '-z'],
    rows.map(({ mode, type, sha, name }) => `${mode} ${type} ${sha}\t${name}\0`).join('')
  ).trim()
}

function normalize(git, ref, docs, receiptBlob) {
  const rows = entries(git, ref).filter((row) => row.name !== 'docs')
  rows.push(docs)
  const config = rows.find((row) => row.name === 'config')
  if (config && config.type !== 'tree') {
    throw new Error('The config path is not a tree')
  }
  const configRows = config
    ? entries(git, config.sha).filter((row) => row.name !== receiptName)
    : []
  if (receiptBlob) {
    configRows.push({ mode: '100644', type: 'blob', sha: receiptBlob, name: receiptName })
  }
  if (config) {
    rows.splice(rows.indexOf(config), 1)
  }
  if (configRows.length) {
    rows.push({ mode: '040000', type: 'tree', sha: tree(git, configRows), name: 'config' })
  }
  return tree(git, rows)
}

function paths(git, before, after) {
  return git(['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', before, after, '--'])
    .split('\0')
    .filter(Boolean)
}

function snapshot(git, treeSha, parent) {
  return git(
    [
      '-c',
      'user.name=Upstream content sync',
      '-c',
      'user.email=upstream-tree-sync@localhost',
      '-c',
      'commit.gpgSign=false',
      'commit-tree',
      treeSha,
      ...(parent ? ['-p', parent] : [])
    ],
    'Temporary three-way content snapshot\n'
  ).trim()
}

export function computeUpstreamTreeSync(options) {
  const ctx = context(options)
  const { git, base, target, upstream } = ctx
  const docs = entries(git, target).find((row) => row.name === 'docs')
  if (docs?.mode !== '160000' || docs.type !== 'commit') {
    throw new Error('Frozen product docs must remain a private documentation gitlink')
  }
  const changed = paths(git, base, upstream)
  const documentationPaths = changed.filter(
    (file) => file === 'docs' || file.startsWith('docs/') || file === '.gitmodules'
  )
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
  if (documentationPaths.length || documentationShas.length) {
    const error = new Error(
      'Upstream docs changes require authenticated private documentation absorption before content synchronization'
    )
    error.details = { documentationPaths, documentationShas, base, upstream, target }
    throw error
  }
  if (changed.some((file) => [TREE_SYNC_RECEIPT_PATH, STATE_PATH].includes(file))) {
    throw new Error('Upstream changes cannot overwrite product-owned synchronization metadata')
  }
  const absorbedUpstreamShas = git(['rev-list', '--reverse', `${base}..${upstream}`, '--'])
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  const baseTreeSha = git(['rev-parse', `${base}^{tree}`]).trim()
  const targetTreeSha = git(['rev-parse', `${target}^{tree}`]).trim()
  const upstreamTreeSha = git(['rev-parse', `${upstream}^{tree}`]).trim()
  const normalizedBase = normalize(git, base, docs)
  const normalizedTarget = normalize(git, target, docs)
  const normalizedUpstream = normalize(git, upstream, docs)
  const ancestor = snapshot(git, normalizedBase)
  let mergedTreeSha
  try {
    mergedTreeSha = git([
      '-c',
      'merge.renames=true',
      '-c',
      'merge.conflictStyle=merge',
      'merge-tree',
      '--write-tree',
      snapshot(git, normalizedTarget, ancestor),
      snapshot(git, normalizedUpstream, ancestor)
    ]).trim()
  } catch (cause) {
    const error = new Error(
      cause.status === 1
        ? 'Three-way content conflicts require individual product-boundary review'
        : 'Content synchronization requires Git merge-tree --write-tree (Git 2.38+)'
    )
    error.details = {
      base,
      upstream,
      target,
      output: String(cause.stdout ?? ''),
      error: String(cause.stderr ?? '')
    }
    throw error
  }
  if (!SHA_PATTERN.test(mergedTreeSha)) {
    throw new Error('Git did not produce one clean merged tree')
  }
  const receipt = {
    schemaVersion: 1,
    kind: 'three-way-content',
    upstream: 'stablyai/orca',
    baseUpstreamSha: base,
    upstreamSha: upstream,
    targetSha: target,
    baseTreeSha,
    upstreamTreeSha,
    targetTreeSha,
    mergedTreeSha,
    docs: { path: 'docs', mode: '160000', sha: docs.sha, upstreamChanged: false },
    absorbedUpstreamShas
  }
  return { ...ctx, docs, receipt, absorbedUpstreamShas, mergedTreeSha }
}

function receiptText(receipt) {
  return `${JSON.stringify(receipt, null, 2)}\n`
}

function receiptedTree({ git, docs, receipt, mergedTreeSha }) {
  const blob = git(['hash-object', '-w', '--stdin'], receiptText(receipt)).trim()
  return normalize(git, mergedTreeSha, docs, blob)
}

function cleanFrozenCheckout({ git, target, range }) {
  if (
    resolveCommit(git, 'HEAD') !== target ||
    git(['symbolic-ref', '--quiet', '--short', 'HEAD']).trim() !== range.targetBranch
  ) {
    throw new Error('Prepare must run on the exact frozen product target branch')
  }
  if (git(['status', '--porcelain']).trim() || git(['ls-files', '-u']).trim()) {
    throw new Error('Prepare refuses a dirty product checkout or index')
  }
  for (const state of ['MERGE_HEAD', 'rebase-merge', 'rebase-apply']) {
    const file = resolve(
      git(['rev-parse', '--show-toplevel']).trim(),
      git(['rev-parse', '--git-path', state]).trim()
    )
    try {
      readFileSync(file)
      throw new Error('Prepare refuses an active merge or rebase')
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error
      }
    }
  }
}

export function prepareUpstreamTreeSync(options) {
  const computed = computeUpstreamTreeSync(options)
  cleanFrozenCheckout(computed)
  if (!computed.absorbedUpstreamShas.length) {
    return { changed: false, receipt: null, absorbedUpstreamShas: [] }
  }
  const { git, receipt } = computed
  const candidateTree = receiptedTree(computed)
  git(['read-tree', '--reset', '-u', candidateTree])
  return { changed: true, receipt, absorbedUpstreamShas: computed.absorbedUpstreamShas }
}

export function verifyUpstreamTreeSync(options) {
  const computed = computeUpstreamTreeSync(options)
  const { git, target, receipt, absorbedUpstreamShas } = computed
  const head = resolveCommit(git, options.head ?? 'HEAD')
  git(['merge-base', '--is-ancestor', target, head])
  const commits = git(['rev-list', '--reverse', `${target}..${head}`, '--'])
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  let parent = target
  for (const commit of commits) {
    const parents = git(['rev-list', '--parents', '-n', '1', commit]).trim().split(/\s+/).slice(1)
    if (parents.length !== 1 || parents[0] !== parent) {
      throw new Error('Candidate must contain only single-parent product commits')
    }
    parent = commit
  }
  const contentCommitSha = absorbedUpstreamShas.length ? commits[0] : null
  if (absorbedUpstreamShas.length) {
    if (!contentCommitSha) {
      throw new Error('Candidate is missing the content absorption commit')
    }
    const recorded = git(['show', `${contentCommitSha}:${TREE_SYNC_RECEIPT_PATH}`])
    if (
      recorded !== receiptText(receipt) ||
      git(['rev-parse', `${contentCommitSha}^{tree}`]).trim() !== receiptedTree(computed)
    ) {
      throw new Error('Frozen inputs, receipt or recomputed content tree differs')
    }
    if (git(['show', `${head}:${TREE_SYNC_RECEIPT_PATH}`]) !== recorded) {
      throw new Error('Candidate changed the content absorption receipt')
    }
  }
  let previous = contentCommitSha ?? target
  for (const commit of commits.slice(contentCommitSha ? 1 : 0)) {
    if (paths(git, previous, commit).some((file) => file !== STATE_PATH)) {
      throw new Error('Only the checkpoint state may change after content absorption')
    }
    previous = commit
  }
  return {
    receipt: contentCommitSha ? receipt : null,
    absorbedUpstreamShas,
    contentCommitSha,
    checkpointOnly: !contentCommitSha
  }
}

function parse(argv) {
  const [command, ...args] = argv
  if (!['prepare', 'verify'].includes(command)) {
    throw new Error('Use upstream-tree-sync.mjs prepare|verify')
  }
  const options = { cwd: process.cwd() }
  const names = {
    '--cwd': 'cwd',
    '--target': 'target',
    '--upstream': 'upstream',
    '--head': 'head',
    '--target-branch': 'targetBranch',
    '--report': 'report'
  }
  for (let index = 0; index < args.length; index += 2) {
    if (!names[args[index]] || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error('Invalid tree-sync arguments')
    }
    options[names[args[index]]] = args[index + 1]
  }
  return { command, options }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  let report
  try {
    const parsed = parse(process.argv.slice(2))
    report = parsed.options.report
    const result =
      parsed.command === 'prepare'
        ? prepareUpstreamTreeSync(parsed.options)
        : verifyUpstreamTreeSync(parsed.options)
    if (report) {
      mkdirSync(dirname(resolve(report)), { recursive: true })
      writeFileSync(report, `${JSON.stringify({ passed: true, ...result }, null, 2)}\n`)
    }
    process.stdout.write(
      `Verified upstream content interval: ${result.absorbedUpstreamShas.length} commits\n`
    )
  } catch (error) {
    if (report) {
      mkdirSync(dirname(resolve(report)), { recursive: true })
      writeFileSync(
        report,
        `${JSON.stringify({ passed: false, message: error.message, ...error.details }, null, 2)}\n`
      )
    }
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
