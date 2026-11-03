import { normalizeExecutionHostId, type ExecutionHostId } from '../execution-host'

export type GitHubLinkBase = {
  hostId: ExecutionHostId
  instanceId: string | null
  linkedPR: number | null
  suppressedGitHubPR: number | null
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function prNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
}

/** Capture the displayed DTO. Ownership comes from its explicit host identity, never a local default. */
export function captureWorktreeGitHubLinkBase(value: unknown): GitHubLinkBase | null {
  if (!object(value) || !Object.hasOwn(value, 'linkedPR') || !prNumber(value.linkedPR)) {
    return null
  }
  const identity = Object.hasOwn(value, 'identity') ? value.identity : undefined
  if (identity !== undefined && !object(identity)) {
    return null
  }
  const identityHost =
    object(identity) && Object.hasOwn(identity, 'executionHostId')
      ? identity.executionHostId
      : undefined
  const hosts: ExecutionHostId[] = []
  for (const candidate of [
    Object.hasOwn(value, 'hostId') ? value.hostId : undefined,
    identityHost
  ]) {
    if (candidate === undefined) {
      continue
    }
    const host = typeof candidate === 'string' ? normalizeExecutionHostId(candidate) : null
    if (!host) {
      return null
    }
    hosts.push(host)
  }
  const hostId = hosts[0]
  if (!hostId || hosts.some((host) => host !== hostId)) {
    return null
  }
  const instanceId = Object.hasOwn(value, 'instanceId') ? value.instanceId : undefined
  const suppressedGitHubPR = Object.hasOwn(value, 'suppressedGitHubPR')
    ? value.suppressedGitHubPR
    : undefined
  if (instanceId !== undefined && (typeof instanceId !== 'string' || !instanceId.trim())) {
    return null
  }
  if (suppressedGitHubPR !== undefined && !prNumber(suppressedGitHubPR)) {
    return null
  }
  return {
    hostId,
    instanceId: instanceId ?? null,
    linkedPR: value.linkedPR,
    suppressedGitHubPR: suppressedGitHubPR ?? null
  }
}
