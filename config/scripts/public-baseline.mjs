import {
  readCommitJson,
  resolveCommit,
  SHA_PATTERN,
  STATE_PATH
} from './upstream-sync-checkpoint.mjs'

const RECEIPT_PATH = 'config/open-source-baseline.json'
const LEDGER_PATH = 'config/upstream-change-ledger.json'
const ARCHIVE = 'https://github.com/coder-lulu/hive-code-next-history'

export function collectImportedAdaptations({ git, head }) {
  const headSha = resolveCommit(git, head)
  const current = readCommitJson(git, headSha, RECEIPT_PATH, true)
  const roots = git(['rev-list', '--max-parents=0', headSha, '--']).trim().split(/\s+/)
  if (roots.length !== 1) {
    if (current || roots.some((root) => readCommitJson(git, root, RECEIPT_PATH, true))) {
      throw new Error('Public baseline requires exactly one product root')
    }
    return new Map()
  }
  const root = roots[0]
  const receipt = readCommitJson(git, root, RECEIPT_PATH, true)
  // The receipt is introduced only by the new root, never by an old-history preparation commit.
  if (!receipt) {
    return new Map()
  }
  if (!current || JSON.stringify(current) !== JSON.stringify(receipt)) {
    throw new Error('Public baseline receipt must remain immutable')
  }
  if (
    receipt.schemaVersion !== 1 ||
    receipt.kind !== 'public-tree-baseline' ||
    receipt.archiveRepository !== ARCHIVE ||
    ![
      receipt.sourceCommit,
      receipt.sourceTree,
      receipt.ledgerBlob,
      receipt.reviewedUpstreamSha
    ].every((sha) => typeof sha === 'string' && SHA_PATTERN.test(sha)) ||
    !Array.isArray(receipt.preservedProductCommits) ||
    !receipt.preservedProductCommits.length ||
    receipt.preservedProductCommits.some(
      (sha) => typeof sha !== 'string' || !SHA_PATTERN.test(sha)
    ) ||
    !Array.isArray(receipt.pendingShas) ||
    receipt.pendingShas.some((sha) => typeof sha !== 'string' || !SHA_PATTERN.test(sha))
  ) {
    throw new Error('Invalid public baseline provenance')
  }
  const ledgerBlob = git(['rev-parse', `${root}:${LEDGER_PATH}`]).trim()
  if (ledgerBlob !== receipt.ledgerBlob) {
    throw new Error('Public baseline ledger blob is invalid')
  }
  const state = readCommitJson(git, root, STATE_PATH)
  if (
    state.lastReviewedUpstreamSha !== receipt.reviewedUpstreamSha ||
    JSON.stringify(state.pendingShas) !== JSON.stringify(receipt.pendingShas)
  ) {
    throw new Error('Public baseline must preserve the reviewed cursor and pending decisions')
  }
  const initialLedger = readCommitJson(git, root, LEDGER_PATH)
  const currentLedger = readCommitJson(git, headSha, LEDGER_PATH)
  if (
    initialLedger.schemaVersion !== 1 ||
    !Array.isArray(initialLedger.entries) ||
    currentLedger.schemaVersion !== 1 ||
    !Array.isArray(currentLedger.entries)
  ) {
    throw new Error('Invalid public baseline change ledger')
  }
  const original = new Map(initialLedger.entries.map((entry) => [entry.upstreamSha, entry]))
  const imported = new Map()
  for (const entry of currentLedger.entries) {
    if (
      receipt.preservedProductCommits.includes(entry.productSha) &&
      JSON.stringify(entry) === JSON.stringify(original.get(entry.upstreamSha))
    ) {
      imported.set(entry.upstreamSha, entry)
    }
  }
  return imported
}
