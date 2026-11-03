import { translate } from '../i18n/mobile-i18n'
import type { RpcSendParams } from '../transport/rpc-params-contract'
import { refusedRpcMessageOrFallback } from '../transport/rpc-refusal-message'
import type { RpcOperationSender } from '../transport/rpc-operation-sender'
import {
  worktreeGitHubLinkBaseRead,
  worktreeLinkSet,
  worktreeReviewClear,
  worktreeSummaryRead,
  type MobileReviewWorktreeSummary
} from './mobile-worktree-metadata-operations'
import type { GitHubLinkBase } from '../../../src/shared/worktree/github-link-base'

// Link / unlink review metadata via worktree.set (the same path desktop uses).
// GitHub's existing manual link flow writes linkedPR; hosted-review creation maps
// each provider to its own linked* field so mobile follow-up reads get the same
// authoritative hint as desktop.

export type MobilePrLinkOutcome = { ok: true } | { ok: false; error: string }

// Pure param builder (unit-tested): the worktree selector + tri-state linkedPR.
export function buildWorktreeSetLinkParams(
  worktreeId: string,
  linkedPR: number | null
): RpcSendParams<'worktree.set'> {
  return { worktree: `id:${worktreeId}`, linkedPR }
}

export function buildWorktreeSetHostedReviewLinkParams(
  worktreeId: string,
  provider: string,
  number: number | null,
  options?: { baseRef?: string | null }
): RpcSendParams<'worktree.set'> {
  const trimmedBaseRef = options?.baseRef?.trim()
  const base = {
    worktree: `id:${worktreeId}`,
    ...(trimmedBaseRef ? { baseRef: trimmedBaseRef } : {})
  }
  switch (provider) {
    case 'github':
      return { ...base, linkedPR: number }
    case 'gitlab':
      return { ...base, linkedGitLabMR: number }
    case 'bitbucket':
      return { ...base, linkedBitbucketPR: number }
    case 'azure-devops':
      return { ...base, linkedAzureDevOpsPR: number }
    case 'gitea':
      return { ...base, linkedGiteaPR: number }
    // 'unsupported', and any token this build does not know: no linked* field to write.
    default:
      return base
  }
}

/**
 * Two catches, because main had two paths: a refusal falls back to the screen's copy when the
 * host sent no message, while a transport drop surfaces its own message verbatim.
 */
async function setWorktreeReviewLink(
  client: RpcOperationSender,
  params: RpcSendParams<'worktree.set'>,
  fallback: string
): Promise<MobilePrLinkOutcome> {
  let reply
  try {
    reply = await worktreeLinkSet.request(client, params)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : fallback }
  }
  try {
    worktreeLinkSet.interpret(reply)
  } catch (error) {
    return { ok: false, error: refusedRpcMessageOrFallback(error, fallback) }
  }
  return { ok: true }
}

export function linkMobilePr(
  client: RpcOperationSender,
  worktreeId: string,
  prNumber: number
): Promise<MobilePrLinkOutcome> {
  return setWorktreeReviewLink(
    client,
    buildWorktreeSetLinkParams(worktreeId, prNumber),
    'Failed to update linked pull request'
  )
}

export async function linkMobileHostedReview(
  client: RpcOperationSender,
  worktreeId: string,
  provider: string,
  number: number,
  options?: { baseRef?: string | null }
): Promise<MobilePrLinkOutcome> {
  const params = buildWorktreeSetHostedReviewLinkParams(worktreeId, provider, number, options)
  if (Object.keys(params).length === 1) {
    return { ok: true }
  }
  // Why a distinct fallback: the review already exists, so callers surface this as a non-fatal
  // refresh problem rather than losing the created URL.
  return setWorktreeReviewLink(client, params, 'Failed to update linked review')
}

export function unlinkMobilePr(
  client: RpcOperationSender,
  worktreeId: string,
  prNumber: number,
  githubLinkBase: GitHubLinkBase | null
): Promise<MobilePrLinkOutcome> {
  if (!Number.isSafeInteger(prNumber) || prNumber <= 0) {
    return Promise.resolve({
      ok: false,
      error: translate(
        'auto.mobile.src.source.control.mobile.pr.link.62c326b385',
        'Invalid pull request number.'
      )
    })
  }
  if (!githubLinkBase) {
    return Promise.resolve({
      ok: false,
      error: translate(
        'auto.mobile.src.source.control.mobile.pr.link.89597fa756',
        'Refresh the worktree before unlinking its pull request.'
      )
    })
  }
  return setWorktreeReviewLink(
    client,
    {
      ...buildWorktreeSetLinkParams(worktreeId, null),
      suppressedGitHubPR: prNumber,
      githubLinkBase
    },
    'Failed to update linked pull request'
  )
}

export type WorktreeGitHubPRLink = {
  worktreeId: string
  githubLinkBase: GitHubLinkBase
  summary: MobileReviewWorktreeSummary | null
}

async function readWorktreeSummary(
  client: RpcOperationSender,
  worktreeId: string
): Promise<WorktreeGitHubPRLink | null> {
  try {
    const reply = await worktreeGitHubLinkBaseRead.request(
      client,
      { worktree: `id:${worktreeId}` },
      { failWhenDisconnected: true }
    )
    const result = worktreeGitHubLinkBaseRead.interpret(reply)
    const value = result.accepted ? result.value : null
    return value?.id === worktreeId && value.githubLinkBase
      ? { worktreeId, githubLinkBase: value.githubLinkBase, summary: value.summary }
      : null
  } catch {
    return null
  }
}

export function fetchWorktreeGitHubPRLink(
  client: RpcOperationSender,
  worktreeId: string
): Promise<WorktreeGitHubPRLink | null> {
  return readWorktreeSummary(client, worktreeId)
}

export async function fetchWorktreeGitHubLinkBase(
  client: RpcOperationSender,
  worktreeId: string
): Promise<GitHubLinkBase | null> {
  return (await readWorktreeSummary(client, worktreeId))?.githubLinkBase ?? null
}

// Re-read the exact target before clearing; the producer compares the same persisted snapshot.
export async function clearMobileWorktreeReviewLink(
  client: RpcOperationSender,
  worktreeId: string,
  expected: WorktreeGitHubPRLink,
  isCurrent: () => boolean
): Promise<MobilePrLinkOutcome> {
  const stale = (): MobilePrLinkOutcome => ({
    ok: false,
    error: translate(
      'auto.mobile.src.source.control.mobile.pr.link.a5f8d09c39',
      'Pull request cleanup is no longer current.'
    )
  })
  if (
    !isCurrent() ||
    expected.worktreeId !== worktreeId ||
    !expected.summary ||
    expected.githubLinkBase.linkedPR === null
  ) {
    return stale()
  }
  const current = await readWorktreeSummary(client, worktreeId)
  if (!isCurrent() || !current?.summary) {
    return stale()
  }
  const before = expected.githubLinkBase
  const after = current.githubLinkBase
  if (
    before.hostId !== after.hostId ||
    before.instanceId !== after.instanceId ||
    before.linkedPR !== after.linkedPR ||
    before.suppressedGitHubPR !== after.suppressedGitHubPR ||
    current.summary.branch !== expected.summary.branch ||
    current.summary.head !== expected.summary.head ||
    current.summary.pushTargetBranch !== expected.summary.pushTargetBranch ||
    current.summary.isBare ||
    current.summary.isArchived
  ) {
    return stale()
  }
  let reply
  try {
    reply = await worktreeReviewClear.request(
      client,
      {
        worktree: `id:${worktreeId}`,
        linkedPR: null,
        githubLinkBase: before
      },
      { failWhenDisconnected: true }
    )
    if (!isCurrent()) {
      return stale()
    }
    worktreeReviewClear.interpret(reply)
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: refusedRpcMessageOrFallback(error, 'Failed to clear stale pull request')
    }
  }
}

// Reads the worktree's persisted linkedPR so the sidebar can surface a linked PR even when it's
// closed/merged and the branch-based lookup returns nothing. Null when unset or on any failure.
export async function fetchWorktreeLinkedPR(
  client: RpcOperationSender,
  worktreeId: string
): Promise<number | null> {
  try {
    const reply = await worktreeSummaryRead.request(client, { worktree: `id:${worktreeId}` })
    const summary = worktreeSummaryRead.interpret(reply)
    return summary.accepted ? (summary.value?.linkedPR ?? null) : null
  } catch {
    // Why: a fallback read — a transport drop is non-fatal, fall back to "no link".
    return null
  }
}
