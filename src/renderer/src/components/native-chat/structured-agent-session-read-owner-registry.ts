import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import type { StructuredAgentSessionReadOwner } from './structured-agent-session-read-owner'

const owners = new Map<string, StructuredAgentSessionReadOwner>()
const snapshotListeners = new Set<() => void>()
export function notifyStructuredReadSnapshotListeners(): void {
  for (const listener of snapshotListeners) {
    listener()
  }
}
export function subscribeStructuredAgentSessionReadSnapshots(listener: () => void): () => void {
  snapshotListeners.add(listener)
  return () => {
    snapshotListeners.delete(listener)
  }
}
export function getExistingStructuredAgentSessionReadOwner(
  sessionId: string,
  target: RuntimeClientTarget
): StructuredAgentSessionReadOwner | null {
  return findStructuredAgentSessionReadOwner(sessionId, target) ?? null
}
export function structuredReadOwnerKey(sessionId: string, target: RuntimeClientTarget): string {
  return `${target.kind === 'local' ? 'local' : `environment:${target.environmentId}`}:${sessionId}`
}
export function findStructuredAgentSessionReadOwner(
  sessionId: string,
  target: RuntimeClientTarget
): StructuredAgentSessionReadOwner | undefined {
  return owners.get(structuredReadOwnerKey(sessionId, target))
}
export function getOrCreateStructuredReadOwner(
  key: string,
  create: () => StructuredAgentSessionReadOwner
): StructuredAgentSessionReadOwner {
  const existing = owners.get(key)
  if (existing) {
    return existing
  }
  const owner = create()
  owners.set(key, owner)
  return owner
}
/** A held owner names its key again once its last holders released it, never over a live one. */
export function adoptStructuredReadOwner(
  key: string,
  owner: StructuredAgentSessionReadOwner
): void {
  if (!owners.has(key)) {
    owners.set(key, owner)
  }
}
export function forgetStructuredReadOwner(
  key: string,
  owner: StructuredAgentSessionReadOwner
): void {
  if (owners.get(key) === owner) {
    owners.delete(key)
    notifyStructuredReadSnapshotListeners()
  }
}
export function resetStructuredAgentSessionReadOwnersForTests(): void {
  for (const owner of owners.values()) {
    owner.dispose()
  }
  owners.clear()
  notifyStructuredReadSnapshotListeners()
}
