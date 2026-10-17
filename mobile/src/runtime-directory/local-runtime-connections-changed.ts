type Listener = (hostIds: readonly string[]) => void
const listeners = new Set<Listener>()

export function subscribeLocalRuntimeConnectionsChanged(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function notifyLocalRuntimeConnectionsChanged(hostIds: readonly string[]): void {
  for (const listener of listeners) {
    listener(hostIds)
  }
}
