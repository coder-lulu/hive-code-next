import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { readSecureJson, writeSecureJson } from '../hive-account/hive-account-secure-store'

export type HiveRuntimeCloudIdentity = Readonly<{
  schemaVersion: 1
  runtimeInstanceId: string
  privateKeyPkcs8: string
  publicKey: string
  createdAt: number
}>

export type HiveRuntimeCloudIdentityResult =
  | { status: 'ok'; identity: HiveRuntimeCloudIdentity }
  | { status: 'unavailable' | 'unreadable' }

function identityPath(userDataPath: string): string {
  return join(userDataPath, 'hive-runtime-cloud', 'runtime-identity.v1.enc')
}

function isCanonicalBase64(value: string): boolean {
  try {
    return Buffer.from(value, 'base64').toString('base64') === value
  } catch {
    return false
  }
}

function isIdentity(value: unknown): value is HiveRuntimeCloudIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const candidate = value as Partial<HiveRuntimeCloudIdentity>
  const expectedKeys = [
    'schemaVersion',
    'runtimeInstanceId',
    'privateKeyPkcs8',
    'publicKey',
    'createdAt'
  ]
  return (
    Object.keys(candidate).length === expectedKeys.length &&
    expectedKeys.every((key) => key in candidate) &&
    candidate.schemaVersion === 1 &&
    typeof candidate.runtimeInstanceId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      candidate.runtimeInstanceId
    ) &&
    typeof candidate.privateKeyPkcs8 === 'string' &&
    candidate.privateKeyPkcs8.length > 0 &&
    isCanonicalBase64(candidate.privateKeyPkcs8) &&
    typeof candidate.publicKey === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(candidate.publicKey) &&
    typeof candidate.createdAt === 'number' &&
    Number.isSafeInteger(candidate.createdAt) &&
    candidate.createdAt > 0
  )
}

function createIdentity(now: number): HiveRuntimeCloudIdentity {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const publicJwk = publicKey.export({ format: 'jwk' }) as { x?: string }
  if (!publicJwk.x || !/^[A-Za-z0-9_-]{43}$/.test(publicJwk.x)) {
    throw new Error('hive_runtime_cloud_public_key_export_failed')
  }
  return {
    schemaVersion: 1,
    runtimeInstanceId: randomUUID(),
    privateKeyPkcs8: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    publicKey: publicJwk.x,
    createdAt: now
  }
}

export function getOrCreateHiveRuntimeCloudIdentity(
  userDataPath: string,
  now: number = Date.now()
): HiveRuntimeCloudIdentityResult {
  const path = identityPath(userDataPath)
  const stored = readSecureJson(path, isIdentity)
  if (stored.status === 'ok') {
    return { status: 'ok', identity: stored.value }
  }
  if (stored.status !== 'missing') {
    return { status: stored.status }
  }
  const identity = createIdentity(now)
  if (!writeSecureJson(path, identity)) {
    return { status: 'unavailable' }
  }
  return { status: 'ok', identity }
}
