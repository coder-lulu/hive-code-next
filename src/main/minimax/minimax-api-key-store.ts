import { existsSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { hardenExistingSecureFile, writeSecureFile } from '../../shared/secure-file'
import { ElectronSecretStore } from '../host/electron-secret-store'
import type { SecretAtRestProtection } from '../../shared/secret-at-rest-protection'

const MINIMAX_API_KEY_FILE = 'minimax-api-key.enc'
const API_KEY_ENVELOPE_PREFIX = 'orca-minimax-api-key:v1:'
let cachedMiniMaxApiKey: string | null = null
let warnedMiniMaxApiKeyStatusHardenFailure = false

type MiniMaxApiKeyEnvelope = {
  kind: 'encrypted' | 'plaintext'
  payload: Buffer
}

function getOrcaDir(): string {
  return join(homedir(), '.orca')
}

function getMiniMaxApiKeyPath(): string {
  return join(getOrcaDir(), MINIMAX_API_KEY_FILE)
}

function encodeApiKeyEnvelope(kind: MiniMaxApiKeyEnvelope['kind'], payload: Buffer): string {
  return `${API_KEY_ENVELOPE_PREFIX}${kind}:${payload.toString('base64')}`
}

function decodeApiKeyEnvelope(raw: Buffer): MiniMaxApiKeyEnvelope {
  const text = raw.toString('utf8')
  if (!text.startsWith(API_KEY_ENVELOPE_PREFIX)) {
    throw new Error('MiniMax API key could not be decrypted')
  }
  const rest = text.slice(API_KEY_ENVELOPE_PREFIX.length)
  const separator = rest.indexOf(':')
  if (separator === -1) {
    throw new Error('MiniMax API key could not be decrypted')
  }
  const kind = rest.slice(0, separator)
  if (kind !== 'encrypted' && kind !== 'plaintext') {
    throw new Error('MiniMax API key could not be decrypted')
  }
  return {
    kind,
    payload: Buffer.from(rest.slice(separator + 1), 'base64')
  }
}

function readEnvelope(envelope: MiniMaxApiKeyEnvelope): string {
  const secretStore = new ElectronSecretStore()
  if (
    envelope.kind !== 'encrypted' ||
    !secretStore.isEncryptionAvailable() ||
    secretStore.describeProtectionGap() !== null
  ) {
    throw new Error('MiniMax API key could not be decrypted')
  }
  return secretStore.decryptString(envelope.payload)
}

function readStoredEnvelope(keyPath: string): MiniMaxApiKeyEnvelope | null {
  const raw = readFileSync(keyPath)
  try {
    const envelope = decodeApiKeyEnvelope(raw)
    if (envelope.kind === 'plaintext') {
      envelope.payload.fill(0)
      rmSync(keyPath, { force: true })
      return null
    }
    return envelope
  } finally {
    raw.fill(0)
  }
}

export function hasMiniMaxApiKey(): boolean {
  const keyPath = getMiniMaxApiKeyPath()
  if (!existsSync(keyPath)) {
    return false
  }
  try {
    hardenExistingSecureFile(keyPath)
  } catch (error) {
    if (!warnedMiniMaxApiKeyStatusHardenFailure) {
      warnedMiniMaxApiKeyStatusHardenFailure = true
      console.warn('[minimax] Failed to harden MiniMax API key file while checking status', error)
    }
  }
  try {
    return readStoredEnvelope(keyPath) !== null
  } catch {
    return false
  }
}

/**
 * How the stored key is protected, or null when none is stored.
 *
 * Reads the envelope kind only — no decrypt, so this cannot trigger a keychain prompt
 * and is safe to call from a status handler.
 */
export function getMiniMaxApiKeyProtection(): SecretAtRestProtection | null {
  const keyPath = getMiniMaxApiKeyPath()
  if (!existsSync(keyPath)) {
    return null
  }
  try {
    return decodeApiKeyEnvelope(readFileSync(keyPath)).kind === 'plaintext' ? 'plaintext' : 'sealed'
  } catch {
    // An undecodable envelope is a decrypt-time error to report, not a protection claim.
    return null
  }
}

export function saveMiniMaxApiKey(key: string): void {
  const trimmed = key.trim()
  if (!trimmed) {
    throw new Error('MiniMax API key is required')
  }
  const secretStore = new ElectronSecretStore()
  let protectedAtRest = false
  try {
    protectedAtRest =
      secretStore.isEncryptionAvailable() && secretStore.describeProtectionGap() === null
  } catch {
    // A failed protection probe cannot authorize a credential write.
  }
  if (!protectedAtRest) {
    throw new Error(
      'Could not save MiniMax API key securely. Install and unlock an OS keyring or keychain, then retry.'
    )
  }
  writeSecureFile(
    getMiniMaxApiKeyPath(),
    encodeApiKeyEnvelope('encrypted', secretStore.encryptString(trimmed))
  )
  cachedMiniMaxApiKey = trimmed
}

export function readMiniMaxApiKey(): string | null {
  if (cachedMiniMaxApiKey !== null) {
    return cachedMiniMaxApiKey
  }
  const keyPath = getMiniMaxApiKeyPath()
  if (!existsSync(keyPath)) {
    return null
  }
  // Why: keep hardening out of the decode/decrypt try below so a chmod/ACL
  // failure isn't misreported as a decrypt failure (matches hasMiniMaxApiKey).
  try {
    hardenExistingSecureFile(keyPath)
  } catch (error) {
    console.warn('[minimax] Failed to harden MiniMax API key file while reading', error)
  }
  try {
    const envelope = readStoredEnvelope(keyPath)
    cachedMiniMaxApiKey = envelope === null ? null : readEnvelope(envelope)
    return cachedMiniMaxApiKey
  } catch {
    console.error('[minimax] failed to decode/decrypt API key')
    throw new Error('MiniMax API key could not be decrypted')
  }
}

export function clearMiniMaxApiKey(): void {
  cachedMiniMaxApiKey = null
  rmSync(getMiniMaxApiKeyPath(), { force: true })
}
