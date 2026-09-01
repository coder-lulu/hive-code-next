#!/usr/bin/env node

import { createReadStream, openAsBlob } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { createHash } from 'node:crypto'
import { createReleaseVerificationAttestation } from '../../config/scripts/hivecloud-release-attestation.mjs'

const apiBase = String(process.env.HIVECLOUD_API_URL ?? '')
  .trim()
  .replace(/\/$/, '')
const token = String(process.env.HIVECLOUD_API_TOKEN ?? '').trim()
const apkPath = String(process.env.HIVECLOUD_APK_PATH ?? '').trim()
const versionName = String(process.env.HIVECODE_VERSION ?? '').trim()
const architecture = String(process.env.HIVECODE_ANDROID_ARCHITECTURE || 'arm64_v8a')
  .trim()
  .toLowerCase()
const releaseNotes = String(process.env.HIVECODE_RELEASE_NOTES ?? '').trim()
const signingCertificateFingerprint = String(
  process.env.HIVECODE_ANDROID_SIGNING_FINGERPRINT ?? ''
).trim()
const attestationKey = String(process.env.HIVECLOUD_RELEASE_ATTESTATION_KEY ?? '').trim()
const MAX_ANDROID_ARTIFACT_BYTES = 512 * 1024 * 1024
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const BETA_VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-beta\.(?:0|[1-9]\d*)$/
const MAX_CONTROL_RESPONSE_BYTES = 1024 * 1024

function requireValue(value, name) {
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

function unwrapData(payload) {
  if (payload && typeof payload === 'object' && payload.data !== undefined) {
    return payload.data
  }
  return payload
}

async function hiveCloudRequest(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    // Never follow an API redirect while carrying the release bearer token.
    redirect: 'error',
    signal: options.signal ?? AbortSignal.timeout(60_000),
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      ...(options.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
      ...options.headers
    }
  })
  const text = await readResponseTextWithLimit(response, MAX_CONTROL_RESPONSE_BYTES)
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = text
  }
  if (!response.ok) {
    const detail = typeof payload === 'string' ? payload : JSON.stringify(payload)
    throw new Error(`HiveCloud request failed (${response.status}): ${detail.slice(0, 300)}`)
  }
  return unwrapData(payload)
}

async function readResponseTextWithLimit(response, maxBytes) {
  const contentLength = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel()
    throw new Error('HiveCloud control response is too large')
  }
  if (!response.body) {
    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new Error('HiveCloud control response is too large')
    }
    return text
  }
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new Error('HiveCloud control response is too large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

async function digestFile(path) {
  const sha256 = createHash('sha256')
  const sha512 = createHash('sha512')
  for await (const chunk of createReadStream(path)) {
    sha256.update(chunk)
    sha512.update(chunk)
  }
  return { sha256: sha256.digest('hex'), sha512: sha512.digest('hex') }
}

async function main() {
  requireValue(apiBase, 'HIVECLOUD_API_URL')
  requireValue(token, 'HIVECLOUD_API_TOKEN')
  requireValue(apkPath, 'HIVECLOUD_APK_PATH')
  requireValue(versionName, 'HIVECODE_VERSION')
  requireValue(attestationKey, 'HIVECLOUD_RELEASE_ATTESTATION_KEY')
  const apiUrl = new URL(apiBase)
  if (
    apiUrl.protocol !== 'https:' ||
    apiUrl.username !== '' ||
    apiUrl.password !== '' ||
    apiUrl.search !== '' ||
    apiUrl.hash !== ''
  ) {
    throw new Error(
      'HIVECLOUD_API_URL must be an HTTPS URL without credentials or query parameters'
    )
  }
  if (!BETA_VERSION_PATTERN.test(versionName)) {
    throw new Error(
      `Android HiveCloud releases must use a beta SemVer value (X.Y.Z-beta.N): ${versionName}`
    )
  }
  if (
    !['arm64_v8a', 'armeabi_v7a', 'x86_64', 'universal', 'any'].includes(architecture.toLowerCase())
  ) {
    throw new Error(`Unsupported Android ABI architecture: ${architecture}`)
  }
  if (!/^(?:[0-9a-fA-F]{2}:?){32}$/.test(signingCertificateFingerprint)) {
    throw new Error('HIVECODE_ANDROID_SIGNING_FINGERPRINT must be a SHA-256 fingerprint')
  }

  const appConfig = JSON.parse(await readFile(new URL('../app.json', import.meta.url), 'utf8'))
  const buildNumber = Number.parseInt(
    process.env.HIVECODE_ANDROID_BUILD_NUMBER ?? String(appConfig.expo?.android?.versionCode ?? ''),
    10
  )
  if (!Number.isSafeInteger(buildNumber) || buildNumber < 1) {
    throw new Error('Android build number must be a positive integer')
  }

  const metadata = await stat(apkPath)
  if (!metadata.isFile() || metadata.size < 1 || metadata.size > MAX_ANDROID_ARTIFACT_BYTES) {
    throw new Error(`Android APK must be between 1 byte and ${MAX_ANDROID_ARTIFACT_BYTES} bytes`)
  }
  const digests = await digestFile(apkPath)
  const sha256 = digests.sha256
  const sha512 = digests.sha512
  const release = await findOrCreateRelease(buildNumber)
  const releaseId = requireValue(release?.releaseId, 'HiveCloud releaseId')
  if (!UUID_PATTERN.test(releaseId)) {
    throw new Error('HiveCloud releaseId must be a UUID')
  }
  assertReleaseIdentity(release, buildNumber)
  if (
    !['DRAFT', 'UPLOADING', 'VERIFYING', 'VERIFIED', 'PUBLISHED'].includes(
      String(release.status ?? '').toUpperCase()
    )
  ) {
    throw new Error(`HiveCloud release ${releaseId} is not uploadable`)
  }
  const existingMatches = Array.isArray(release.artifacts)
    ? release.artifacts.filter(
        (candidate) =>
          String(candidate?.architecture ?? '').toLowerCase() === architecture &&
          String(candidate?.packageFormat ?? '').toUpperCase() === 'APK' &&
          String(candidate?.distributionType ?? '').toUpperCase() === 'DIRECT'
      )
    : []
  if (existingMatches.length > 1) {
    throw new Error('HiveCloud has multiple APK artifacts for this Android build')
  }
  const existingArtifact = existingMatches[0] ?? null
  let artifactId
  if (existingArtifact) {
    if (
      String(existingArtifact.sha256 ?? '').toLowerCase() !== sha256 ||
      String(existingArtifact.sha512 ?? '').toLowerCase() !== sha512 ||
      Number(existingArtifact.fileSize) !== metadata.size
    ) {
      throw new Error('HiveCloud already has a different artifact for this Android build')
    }
    artifactId = requireValue(existingArtifact.artifactId, 'HiveCloud artifactId')
    if (!UUID_PATTERN.test(artifactId)) {
      throw new Error('HiveCloud artifactId must be a UUID')
    }
    const artifactStatus = String(existingArtifact.status ?? '').toUpperCase()
    if (!['UPLOADED', 'VERIFIED'].includes(artifactStatus)) {
      throw new Error(
        `HiveCloud Android artifact is not verifiable (status ${artifactStatus || 'unknown'})`
      )
    }
  } else {
    if (String(release.status ?? '').toUpperCase() === 'PUBLISHED') {
      throw new Error(`Published HiveCloud release ${releaseId} is missing the Android APK`)
    }
    const file = await openAsBlob(apkPath)
    if (file.size !== metadata.size) {
      throw new Error('Android APK changed while it was being hashed')
    }
    const form = new FormData()
    form.append('file', file, basename(apkPath))
    form.append('architecture', architecture)
    form.append('packageFormat', 'APK')
    form.append('distributionType', 'DIRECT')
    form.append('signingCertificateFingerprint', signingCertificateFingerprint)
    const uploaded = await hiveCloudRequest(`/hive/v1/admin/releases/${releaseId}/artifacts`, {
      method: 'POST',
      body: form
    })
    const uploadedArtifact = findUploadedArtifact(
      uploaded?.artifacts,
      architecture,
      sha256,
      sha512,
      metadata.size
    )
    artifactId = requireValue(uploadedArtifact?.artifactId, 'HiveCloud artifactId')
    if (!UUID_PATTERN.test(artifactId)) {
      throw new Error('HiveCloud artifactId must be a UUID')
    }
    if (
      typeof uploadedArtifact?.sha256 !== 'string' ||
      uploadedArtifact.sha256.toLowerCase() !== sha256 ||
      typeof uploadedArtifact?.sha512 !== 'string' ||
      uploadedArtifact.sha512.toLowerCase() !== sha512 ||
      !Number.isSafeInteger(Number(uploadedArtifact?.fileSize)) ||
      Number(uploadedArtifact.fileSize) !== metadata.size
    ) {
      throw new Error('HiveCloud artifact evidence did not match the APK bytes')
    }
  }

  if (String(release.status ?? '').toUpperCase() !== 'PUBLISHED') {
    const existingStatus = String(existingArtifact?.status ?? '').toUpperCase()
    if (existingArtifact && existingStatus === 'VERIFIED') {
      // A retried publisher may find an artifact that another worker already
      // verified. The backend intentionally rejects a second verify call.
    } else {
      await hiveCloudRequest(`/hive/v1/admin/releases/artifacts/${artifactId}/verify`, {
        method: 'POST',
        body: JSON.stringify({
          verificationEvidence: createReleaseVerificationAttestation({
            artifactId,
            sha256,
            sha512,
            signingFingerprint: signingCertificateFingerprint,
            platform: 'android',
            key: attestationKey
          })
        })
      })
    }
    await hiveCloudRequest(`/hive/v1/admin/releases/${releaseId}/publish`, { method: 'POST' })
  }
  const checkQuery = new URLSearchParams({
    product: 'hivecode',
    platform: 'android',
    architecture,
    channel: 'beta',
    currentVersion: '0.0.0-beta.0',
    currentBuild: '1'
  })
  const check = await hiveCloudRequest(`/hive/v1/updates/check?${checkQuery}`)
  const latest = check?.latest
  const artifact = check?.artifact ?? latest?.artifact
  if (
    !check?.hasUpdate ||
    latest?.versionName !== versionName ||
    Number(latest?.buildNumber) !== buildNumber ||
    artifact?.sha256?.toLowerCase() !== sha256 ||
    Number(artifact?.size) !== metadata.size
  ) {
    throw new Error('HiveCloud post-publish update check did not expose the uploaded APK')
  }
  console.log(`Published HiveCode Android ${versionName} build ${buildNumber} (${releaseId})`)
}

async function findOrCreateRelease(buildNumber) {
  const query = new URLSearchParams({
    product: 'hivecode',
    platform: 'ANDROID',
    channel: 'BETA',
    limit: '50'
  })
  const existing = await hiveCloudRequest(`/hive/v1/admin/releases?${query}`)
  const match = findReleaseIdentity(existing, buildNumber)
  if (match?.releaseId) {
    return match
  }
  const payload = {
    product: 'hivecode',
    platform: 'ANDROID',
    channel: 'BETA',
    versionName,
    buildNumber,
    releaseNotes,
    mandatory: false
  }
  try {
    return await hiveCloudRequest('/hive/v1/admin/releases', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  } catch (error) {
    const retry = await hiveCloudRequest(`/hive/v1/admin/releases?${query}`)
    const concurrent = findReleaseIdentity(retry, buildNumber)
    if (concurrent?.releaseId) {
      return concurrent
    }
    throw error
  }
}

function findReleaseIdentity(candidates, buildNumber) {
  if (!Array.isArray(candidates)) {
    return null
  }
  return (
    candidates.find(
      (candidate) =>
        candidate?.versionName === versionName && Number(candidate?.buildNumber) === buildNumber
    ) ?? null
  )
}

function assertReleaseIdentity(release, buildNumber) {
  if (
    String(release?.productCode ?? release?.product ?? '').toLowerCase() !== 'hivecode' ||
    String(release?.platform ?? '').toLowerCase() !== 'android' ||
    String(release?.channel ?? '').toLowerCase() !== 'beta' ||
    release?.versionName !== versionName ||
    Number(release?.buildNumber) !== buildNumber
  ) {
    throw new Error('HiveCloud release identity does not match the requested Android build')
  }
}

function findUploadedArtifact(candidates, expectedArchitecture, sha256, sha512, size) {
  const matches = (Array.isArray(candidates) ? candidates : []).filter(
    (candidate) =>
      String(candidate?.architecture ?? '').toLowerCase() === expectedArchitecture &&
      String(candidate?.packageFormat ?? '').toUpperCase() === 'APK' &&
      String(candidate?.distributionType ?? '').toUpperCase() === 'DIRECT' &&
      String(candidate?.sha256 ?? '').toLowerCase() === sha256 &&
      String(candidate?.sha512 ?? '').toLowerCase() === sha512 &&
      Number(candidate?.fileSize) === size
  )
  if (matches.length !== 1) {
    throw new Error('HiveCloud APK response did not identify exactly one uploaded artifact')
  }
  return matches[0]
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
