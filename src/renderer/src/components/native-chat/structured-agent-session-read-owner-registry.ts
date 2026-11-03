import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { StructuredAgentSessionReadOwner } from './structured-agent-session-read-owner'

const snapshotListeners = new Set<() => void>()
export function subscribeStructuredAgentSessionReadSnapshots(listener: () => void): () => void {
  snapshotListeners.add(listener)
  return () => {
    snapshotListeners.delete(listener)
  }
}
export function notifyStructuredReadSnapshots(): void {
  for (const listener of snapshotListeners) {
    listener()
  }
}
const owners = new Map<string, StructuredAgentSessionReadOwner>()
export function structuredReadOwnerKey(
  sessionId: string,
  target: RuntimeClientTarget | null,
  unroutableHost = ''
): string {
  if (!target) {
    return `unroutable:${unroutableHost}:${sessionId}`
  }
  return `${target.kind === 'local' ? 'local' : `environment:${target.environmentId}`}:${sessionId}`
}
export function findStructuredAgentSessionReadOwner(
  sessionId: string,
  target: RuntimeClientTarget | null,
  unroutableHost = ''
): StructuredAgentSessionReadOwner | undefined {
  return owners.get(structuredReadOwnerKey(sessionId, target, unroutableHost))
}
/** A closed chat no longer needs an unmounted create page or an active reader. */
export function retireStructuredAgentSessionReadOwner(
  sessionId: string,
  target: RuntimeClientTarget | null,
  unroutableHost = ''
): void {
  const key = structuredReadOwnerKey(sessionId, target, unroutableHost)
  const owner = owners.get(key)
  owners.delete(key)
  notifyStructuredReadSnapshots()
  try {
    owner?.dispose()
  } catch (error) {
    console.warn('[native-chat] retiring a conversation reader failed', error)
  }
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
  notifyStructuredReadSnapshots()
  return owner
}
/** A held owner names its key again once its last holders released it, never over a live one. */
export function adoptStructuredReadOwner(
  key: string,
  owner: StructuredAgentSessionReadOwner
): void {
  if (!owners.has(key)) {
    owners.set(key, owner)
    notifyStructuredReadSnapshots()
  }
}
export function forgetStructuredReadOwner(
  key: string,
  owner: StructuredAgentSessionReadOwner
): void {
  if (owners.get(key) === owner) {
    owners.delete(key)
    notifyStructuredReadSnapshots()
  }
}
export function resetStructuredAgentSessionReadOwnersForTests(): void {
  for (const owner of owners.values()) {
    owner.dispose()
  }
  owners.clear()
}
