import type { StoredHostProfile } from './types'

export function updateStoredHostNameAndEndpoint(
  hosts: StoredHostProfile[],
  hostId: string,
  updates: { name?: string; endpoint?: string }
): StoredHostProfile[] {
  const index = hosts.findIndex((host) => host.id === hostId)
  if (index === -1) {
    throw new Error('Host not found')
  }
  const next = hosts.slice()
  next[index] = {
    ...next[index]!,
    ...(updates.name !== undefined ? { name: updates.name } : {}),
    ...(updates.endpoint !== undefined ? { endpoint: updates.endpoint } : {})
  }
  return next
}

export function updateStoredHostLastConnected(
  hosts: StoredHostProfile[],
  hostId: string,
  lastConnected: number
): StoredHostProfile[] {
  const index = hosts.findIndex((host) => host.id === hostId)
  if (index === -1) {
    return hosts
  }
  const next = hosts.slice()
  next[index] = { ...next[index]!, lastConnected }
  return next
}
