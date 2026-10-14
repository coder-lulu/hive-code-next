import type { DeviceScope } from '../../shared/runtime-types'
import type { RuntimePairingReach } from '../../shared/runtime-pairing-reach'
import type { RuntimeDeviceGrant } from './rpc/rpc-method-permission'

/** Current token pairing only. Alternative credential and delegated authorities are not admitted. */
export type DeviceEntry = {
  deviceId: string
  name: string
  token: string
  scope: DeviceScope
  pairedAt: number
  lastSeenAt: number
  pairingReach?: RuntimePairingReach
  grants?: RuntimeDeviceGrant[]
  credentialRevision?: number
  callerFingerprint?: string
}
export type TokenDeviceEntry = DeviceEntry

export function isPendingTokenRow(device: DeviceEntry): device is TokenDeviceEntry {
  return device.lastSeenAt === 0 && typeof device.token === 'string' && device.token.length > 0
}

export function sameGrants(entry: DeviceEntry, grants: readonly RuntimeDeviceGrant[]): boolean {
  const current = entry.grants ?? []
  return current.length === grants.length && current.every((grant) => grants.includes(grant))
}

export type AuthenticatedPrincipalBinding = {
  deviceId: string
  credentialRevision?: number
  deviceToken: string
}

export function isStillAuthenticated(device: DeviceEntry, principal: AuthenticatedPrincipalBinding): boolean {
  return device.deviceId === principal.deviceId &&
    (device.credentialRevision ?? 0) === (principal.credentialRevision ?? 0) &&
    device.token === principal.deviceToken
}
