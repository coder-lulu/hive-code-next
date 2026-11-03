// Read the shell’s init.host instead of an absent web keychain; otherwise routes would show Host not found.
import { readPageHostProfile } from '../mobile-web-shell/bridge/page-host-profile'
import type { HostCatalogEntry, HostProfile } from './types'

// The page gets no device credential or public key; RPC uses the shell’s paired client.
function pageHosts(): HostProfile[] {
  const host = readPageHostProfile()
  return host === null ? [] : [{ ...host, deviceToken: '', publicKeyB64: '' }]
}

export const loadHosts = (): Promise<HostProfile[]> => Promise.resolve(pageHosts())
export const peekHosts = (): HostProfile[] | null => pageHosts()

export const loadHostCatalog = (): Promise<HostCatalogEntry[]> =>
  Promise.resolve(
    pageHosts().map((profile) => ({ ...profile, credentialStatus: 'ready' as const, profile }))
  )

// Pairing belongs to the native shell.
export const savePairedHost = (_host: HostProfile): Promise<void> => Promise.resolve()
export function removeHost(_hostId: string): Promise<void>
export function removeHost(
  _hostId: string,
  _expectedPairingRevision: string | null,
  _afterCommit?: () => void | Promise<void>
): Promise<boolean>
export function removeHost(
  _hostId: string,
  expectedPairingRevision?: string | null,
  _afterCommit?: () => void | Promise<void>
): Promise<void | boolean> {
  return Promise.resolve(expectedPairingRevision === undefined ? undefined : false)
}

// Recency belongs to the native host list, which this page does not show.
export const updateLastConnected = (_hostId: string): Promise<void> => Promise.resolve()

/** Runtime identity is persisted by the native shell; this page has no host catalog to mutate. */
export const recordAuthenticatedRuntimeRecordId = (
  _hostId: string,
  _runtimeRecordId: string
): Promise<boolean> => Promise.resolve(false)

export function updateHostNameAndEndpoint(
  _hostId: string,
  _updates: { personalName?: string | null; endpoint?: string }
): Promise<void> {
  return Promise.resolve()
}

// Last-known descriptors belong to the native host list.
export function updateHostDescriptor(
  _hostId: string,
  _descriptor: { machineName: string | null; platform: NodeJS.Platform | null }
): Promise<void> {
  return Promise.resolve()
}
