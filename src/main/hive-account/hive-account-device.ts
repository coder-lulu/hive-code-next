import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto'
import { hostname } from 'node:os'
import type { HiveAccountSessionProfile } from '../../shared/hive-account'
import { hiveAccountSecurePath, readSecureJson, writeSecureJson } from './hive-account-secure-store'

type StoredDeviceIdentity = {
  schemaVersion: 1
  privateKeyPkcs8: string
  publicKey: string
  createdAt: number
}

export type HiveDeviceIdentity = StoredDeviceIdentity & {
  deviceLabel: string
}

export type HiveDeviceIdentityResult =
  | { status: 'ok'; identity: HiveDeviceIdentity }
  | { status: 'unavailable' | 'unreadable' }

function isStoredDeviceIdentity(value: unknown): value is StoredDeviceIdentity {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<StoredDeviceIdentity>
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.privateKeyPkcs8 === 'string' &&
    candidate.privateKeyPkcs8.length > 0 &&
    typeof candidate.publicKey === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(candidate.publicKey) &&
    typeof candidate.createdAt === 'number'
  )
}

function devicePath(userDataPath: string): string {
  return hiveAccountSecurePath(userDataPath, 'device-identity.v1.enc')
}

export function defaultHiveDeviceLabel(): string {
  const normalized = Array.from(hostname())
    .filter((character) => character >= ' ' && character !== '\u007f')
    .join('')
    .trim()
    .slice(0, 128)
  return normalized || 'HiveCode Desktop'
}

function createIdentity(): StoredDeviceIdentity {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const publicJwk = publicKey.export({ format: 'jwk' }) as { x?: string }
  if (!publicJwk.x) {
    throw new Error('hive_device_public_key_export_failed')
  }
  return {
    schemaVersion: 1,
    privateKeyPkcs8: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    publicKey: publicJwk.x,
    createdAt: Date.now()
  }
}

export function getOrCreateHiveDeviceIdentity(userDataPath: string): HiveDeviceIdentityResult {
  const stored = readSecureJson(devicePath(userDataPath), isStoredDeviceIdentity)
  if (stored.status === 'ok') {
    return { status: 'ok', identity: { ...stored.value, deviceLabel: defaultHiveDeviceLabel() } }
  }
  if (stored.status === 'unavailable' || stored.status === 'unreadable') {
    return { status: stored.status }
  }
  const identity = createIdentity()
  if (!writeSecureJson(devicePath(userDataPath), identity)) {
    return { status: 'unavailable' }
  }
  return { status: 'ok', identity: { ...identity, deviceLabel: defaultHiveDeviceLabel() } }
}

export function signHiveDeviceAuthorization(
  identity: HiveDeviceIdentity,
  nonce: string,
  clientId: string,
  sessionProfile: Exclude<HiveAccountSessionProfile, 'LEGACY'>
): string {
  const privateKey = createPrivateKey({
    key: Buffer.from(identity.privateKeyPkcs8, 'base64'),
    format: 'der',
    type: 'pkcs8'
  })
  const context = `hive-device-authorization-v2\n${nonce}\n${clientId}\n${identity.deviceLabel}\n${sessionProfile}`
  return sign(null, Buffer.from(context, 'utf8'), privateKey).toString('base64url')
}
