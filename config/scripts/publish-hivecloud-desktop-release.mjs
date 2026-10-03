#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { createReadStream, openAsBlob } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createReleaseVerificationAttestation } from './hivecloud-release-attestation.mjs'

const apiBase = String(process.env.HIVECLOUD_API_URL ?? '')
  .trim()
  .replace(/\/$/, '')
const token = String(process.env.HIVECLOUD_API_TOKEN ?? '').trim()
const versionName = String(process.env.HIVECODE_VERSION ?? '').trim()
const releaseNotes = String(process.env.HIVECODE_RELEASE_NOTES ?? '').trim()
const platform = String(process.env.HIVECODE_DESKTOP_PLATFORM ?? '')
  .trim()
  .toLowerCase()
const architecture = String(process.env.HIVECODE_DESKTOP_ARCHITECTURE ?? '')
  .trim()
  .toLowerCase()
const channel = String(process.env.HIVECODE_RELEASE_CHANNEL ?? '')
  .trim()
  .toLowerCase()
const signingFingerprint = String(process.env.HIVECODE_SIGNING_CERTIFICATE_FINGERPRINT ?? '').trim()
const attestationKey = String(process.env.HIVECLOUD_RELEASE_ATTESTATION_KEY ?? '').trim()
const requestedReleaseId = String(process.env.HIVECLOUD_RELEASE_ID ?? '').trim()
const shouldPublish =
  String(process.env.HIVECODE_PUBLISH ?? 'true')
    .trim()
    .toLowerCase() !== 'false'
const expectedArtifactCount = Number.parseInt(
  String(process.env.HIVECODE_EXPECTED_ARTIFACTS ?? '1'),
  10
)
const configuredExpectedArchitectures = String(
  process.env.HIVECODE_EXPECTED_ARTIFACT_ARCHITECTURES ?? ''
)
  .split(/[\r\n,]+/)
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean)
const artifactPaths = String(process.env.HIVECODE_ARTIFACT_PATHS ?? '')
  .split(/[\r\n,]+/)
  .map((value) => value.trim())
  .filter(Boolean)

const VALID_PLATFORMS = new Set(['windows', 'macos', 'linux'])
const VALID_ARCHITECTURES = new Set(['x64', 'arm64'])
const VALID_CHANNELS = new Set(['internal', 'beta', 'stable'])
const FORMAT_BY_EXTENSION = new Map([
  ['.exe', 'NSIS'],
  ['.zip', 'ZIP'],
  ['.appimage', 'APPIMAGE']
])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024
const MAX_CONTROL_RESPONSE_BYTES = 1024 * 1024
const STABLE_VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/
const BETA_VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-beta\.(?:0|[1-9]\d*)$/

function requireValue(value, name) {
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

function unwrapData(payload) {
  return payload && typeof payload === 'object' && payload.data !== undefined
    ? payload.data
    : payload
}

function validateInputs() {
  requireValue(apiBase, 'HIVECLOUD_API_URL')
  requireValue(token, 'HIVECLOUD_API_TOKEN')
  requireValue(versionName, 'HIVECODE_VERSION')
  requireValue(platform, 'HIVECODE_DESKTOP_PLATFORM')
  requireValue(architecture, 'HIVECODE_DESKTOP_ARCHITECTURE')
  requireValue(channel, 'HIVECODE_RELEASE_CHANNEL')
  requireValue(attestationKey, 'HIVECLOUD_RELEASE_ATTESTATION_KEY')
  if (!/^https:\/\//i.test(apiBase)) {
    throw new Error('HIVECLOUD_API_URL must use HTTPS')
  }
  const apiUrl = new URL(apiBase)
  if (apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash) {
    throw new Error(
      'HIVECLOUD_API_URL must not contain credentials, query parameters, or fragments'
    )
  }
  if (!VALID_PLATFORMS.has(platform)) {
    throw new Error(`Unsupported desktop platform: ${platform}`)
  }
  if (!VALID_ARCHITECTURES.has(architecture)) {
    throw new Error(`Unsupported desktop architecture: ${architecture}`)
  }
  if (!VALID_CHANNELS.has(channel)) {
    throw new Error(`Unsupported HiveCloud release channel: ${channel}`)
  }
  if (
    (platform === 'macos' && !signingFingerprint) ||
    (signingFingerprint && !/^(?:[0-9a-fA-F]{2}:?){32}$/.test(signingFingerprint))
  ) {
    throw new Error(
      'HIVECODE_SIGNING_CERTIFICATE_FINGERPRINT must be a SHA-256 fingerprint for signed desktop platforms'
    )
  }
  if (!STABLE_VERSION_PATTERN.test(versionName) && !BETA_VERSION_PATTERN.test(versionName)) {
    throw new Error(`HIVECODE_VERSION is not a supported SemVer value: ${versionName}`)
  }
  if (channel === 'stable' && !STABLE_VERSION_PATTERN.test(versionName)) {
    throw new Error('Stable HiveCloud releases must use a stable SemVer value')
  }
  if (channel === 'beta' && !BETA_VERSION_PATTERN.test(versionName)) {
    throw new Error('Beta HiveCloud releases must use a beta SemVer value')
  }
  if (
    channel === 'internal' &&
    !STABLE_VERSION_PATTERN.test(versionName) &&
    !BETA_VERSION_PATTERN.test(versionName)
  ) {
    throw new Error('Internal HiveCloud releases must use a stable or beta SemVer value')
  }
  if (artifactPaths.length === 0) {
    throw new Error('HIVECODE_ARTIFACT_PATHS is required')
  }
  const expectedArchitectures = getExpectedArtifactArchitectures()
  if (expectedArchitectures.length !== expectedArtifactCount) {
    throw new Error(
      'HIVECODE_EXPECTED_ARTIFACT_ARCHITECTURES must list each expected architecture exactly once'
    )
  }
  for (const spec of artifactPaths) {
    const [artifactArchitecture, artifactPath] = splitArtifactSpec(spec)
    if (
      !artifactPath ||
      !VALID_ARCHITECTURES.has(artifactArchitecture) ||
      !expectedArchitectures.includes(artifactArchitecture)
    ) {
      throw new Error(`Artifact must use <architecture>=<path>: ${spec}`)
    }
  }
}

function getExpectedArtifactArchitectures() {
  if (configuredExpectedArchitectures.length > 0) {
    const unique = [...new Set(configuredExpectedArchitectures)]
    if (unique.some((value) => !VALID_ARCHITECTURES.has(value))) {
      throw new Error(
        'HIVECODE_EXPECTED_ARTIFACT_ARCHITECTURES contains an unsupported architecture'
      )
    }
    return unique
  }
  if (expectedArtifactCount === 1) {
    return [architecture]
  }
  throw new Error(
    'HIVECODE_EXPECTED_ARTIFACT_ARCHITECTURES is required when more than one artifact is expected'
  )
}

function splitArtifactSpec(spec) {
  const separator = spec.indexOf('=')
  if (separator === -1) {
    return [architecture, spec]
  }
  return [spec.slice(0, separator).trim().toLowerCase(), spec.slice(separator + 1).trim()]
}

function packageFormat(path) {
  const format = FORMAT_BY_EXTENSION.get(extname(path).toLowerCase())
  if (!format) {
    throw new Error(`Unsupported desktop artifact extension: ${basename(path)}`)
  }
  if (platform === 'windows' && format !== 'NSIS') {
    throw new Error('Windows HiveCloud releases must upload an NSIS installer')
  }
  if (platform === 'macos' && format !== 'ZIP') {
    throw new Error('macOS HiveCloud releases must upload a ZIP updater artifact')
  }
  if (platform === 'linux' && format !== 'APPIMAGE') {
    throw new Error('Linux auto-update releases must upload an AppImage')
  }
  return format
}

async function hiveCloudRequest(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    // Release metadata and bearer credentials must never follow a server-side
    // redirect to an untrusted origin. Artifact downloads are performed by
    // the client through the separately validated HiveCloud gateway.
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

export async function main() {
  validateInputs()
  const buildNumber = Number.parseInt(String(process.env.HIVECODE_BUILD_NUMBER ?? ''), 10)
  if (!Number.isSafeInteger(buildNumber) || buildNumber < 1) {
    throw new Error('HIVECODE_BUILD_NUMBER must be a positive integer')
  }

  if (!Number.isSafeInteger(expectedArtifactCount) || expectedArtifactCount < 1) {
    throw new Error('HIVECODE_EXPECTED_ARTIFACTS must be a positive integer')
  }
  const release = requestedReleaseId
    ? { releaseId: requestedReleaseId }
    : await findOrCreateDraft(buildNumber)
  const releaseId = requireValue(release?.releaseId, 'HiveCloud releaseId')
  if (!UUID_PATTERN.test(releaseId)) {
    throw new Error('HiveCloud releaseId must be a UUID')
  }
  const releaseDetails =
    release.status && Array.isArray(release.artifacts)
      ? release
      : await hiveCloudRequest(`/hive/v1/admin/releases/${releaseId}`)
  assertReleaseIdentity(releaseDetails, buildNumber)
  const releaseStatus = String(releaseDetails?.status ?? '').toUpperCase()
  if (releaseStatus === 'WITHDRAWN') {
    throw new Error('The requested HiveCloud release identity has already been withdrawn')
  }
  const uploadedArtifacts = []

  for (const artifactSpec of artifactPaths) {
    const [artifactArchitecture, artifactPath] = splitArtifactSpec(artifactSpec)
    const format = packageFormat(artifactPath)
    const metadata = await stat(artifactPath)
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > MAX_ARTIFACT_BYTES) {
      throw new Error(
        `Desktop artifact must be a regular file between 1 byte and ${MAX_ARTIFACT_BYTES} bytes: ${artifactPath}`
      )
    }
    const digests = await digestFile(artifactPath)
    const sha256 = digests.sha256
    const sha512 = digests.sha512
    const existingMatches = (
      Array.isArray(releaseDetails?.artifacts) ? releaseDetails.artifacts : []
    ).filter(
      (candidate) =>
        String(candidate?.architecture ?? '').toLowerCase() === artifactArchitecture &&
        String(candidate?.packageFormat ?? '').toUpperCase() === format &&
        String(candidate?.distributionType ?? '').toUpperCase() ===
          (channel === 'internal' ? 'INTERNAL' : 'DIRECT')
    )
    if (existingMatches.length > 1) {
      throw new Error(
        `HiveCloud has multiple artifacts for ${artifactArchitecture}/${format}; refusing an ambiguous release`
      )
    }
    const existingArtifact = existingMatches[0] ?? null
    if (existingArtifact) {
      if (
        String(existingArtifact.sha256 ?? '').toLowerCase() !== sha256 ||
        String(existingArtifact.sha512 ?? '').toLowerCase() !== sha512 ||
        Number(existingArtifact.fileSize) !== metadata.size
      ) {
        throw new Error(
          `HiveCloud already has a different artifact for ${artifactArchitecture}/${format}`
        )
      }
      const artifactId = requireValue(existingArtifact.artifactId, 'HiveCloud artifactId')
      if (!UUID_PATTERN.test(artifactId)) {
        throw new Error('HiveCloud artifactId must be a UUID')
      }
      if (String(existingArtifact.status ?? '').toUpperCase() !== 'VERIFIED') {
        await hiveCloudRequest(`/hive/v1/admin/releases/artifacts/${artifactId}/verify`, {
          method: 'POST',
          body: JSON.stringify({
            verificationEvidence: createReleaseVerificationAttestation({
              artifactId,
              sha256,
              sha512,
              signingFingerprint,
              platform,
              key: attestationKey
            })
          })
        })
      }
      uploadedArtifacts.push({
        artifactId,
        sha256,
        size: metadata.size,
        architecture: artifactArchitecture
      })
      continue
    }
    if (releaseStatus === 'PUBLISHED') {
      throw new Error(
        `Published HiveCloud release ${releaseId} is missing ${artifactArchitecture}/${format}`
      )
    }
    const form = new FormData()
    const file = await openAsBlob(artifactPath)
    if (file.size !== metadata.size) {
      throw new Error(`Desktop artifact changed while it was being hashed: ${artifactPath}`)
    }
    form.append('file', file, basename(artifactPath))
    form.append('architecture', artifactArchitecture)
    form.append('packageFormat', format)
    form.append('distributionType', channel === 'internal' ? 'INTERNAL' : 'DIRECT')
    if (signingFingerprint) {
      form.append('signingCertificateFingerprint', signingFingerprint)
    }
    const uploaded = await hiveCloudRequest(`/hive/v1/admin/releases/${releaseId}/artifacts`, {
      method: 'POST',
      body: form
    })
    const artifact = findUploadedArtifact(
      uploaded?.artifacts,
      artifactArchitecture,
      format,
      channel === 'internal' ? 'INTERNAL' : 'DIRECT',
      sha256,
      sha512,
      metadata.size
    )
    const artifactId = requireValue(artifact?.artifactId, 'HiveCloud artifactId')
    if (!UUID_PATTERN.test(artifactId)) {
      throw new Error('HiveCloud artifactId must be a UUID')
    }
    if (
      typeof artifact?.sha256 !== 'string' ||
      artifact.sha256.toLowerCase() !== sha256 ||
      typeof artifact?.sha512 !== 'string' ||
      artifact.sha512.toLowerCase() !== sha512 ||
      !Number.isSafeInteger(Number(artifact?.fileSize)) ||
      Number(artifact.fileSize) !== metadata.size
    ) {
      throw new Error(`HiveCloud artifact evidence did not match ${basename(artifactPath)}`)
    }
    await hiveCloudRequest(`/hive/v1/admin/releases/artifacts/${artifactId}/verify`, {
      method: 'POST',
      body: JSON.stringify({
        verificationEvidence: createReleaseVerificationAttestation({
          artifactId,
          sha256,
          sha512,
          signingFingerprint,
          platform,
          key: attestationKey
        })
      })
    })
    uploadedArtifacts.push({
      artifactId,
      sha256,
      size: metadata.size,
      architecture: artifactArchitecture
    })
  }

  if (!shouldPublish) {
    console.log(`Uploaded HiveCode Desktop artifacts for draft ${releaseId}`)
    return
  }
  const expectedArchitectures = getExpectedArtifactArchitectures()
  if (expectedArtifactCount > uploadedArtifacts.length || expectedArtifactCount > 1) {
    const deadline = Date.now() + 20 * 60 * 1000
    while (Date.now() < deadline) {
      const current = await hiveCloudRequest(`/hive/v1/admin/releases/${releaseId}`)
      if (hasExpectedVerifiedArtifacts(current, expectedArchitectures)) {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 5000))
    }
  }
  const complete = await hiveCloudRequest(`/hive/v1/admin/releases/${releaseId}`)
  if (!hasExpectedVerifiedArtifacts(complete, expectedArchitectures)) {
    throw new Error(
      `HiveCloud release ${releaseId} did not receive all expected verified artifacts`
    )
  }
  if (releaseStatus !== 'PUBLISHED') {
    await hiveCloudRequest(`/hive/v1/admin/releases/${releaseId}/publish`, { method: 'POST' })
  }
  const checkQuery = new URLSearchParams({
    product: 'hivecode',
    platform,
    architecture,
    channel,
    // Use a known lower prerelease/build pair so post-publish checks do not
    // depend on the release build being greater than one.
    currentVersion: '0.0.0-beta.0',
    currentBuild: '1'
  })
  const check = await hiveCloudRequest(`/hive/v1/updates/check?${checkQuery}`)
  const latest = check?.latest
  if (
    !check?.hasUpdate ||
    latest?.versionName !== versionName ||
    Number(latest?.buildNumber) !== buildNumber
  ) {
    throw new Error('HiveCloud post-publish update check did not expose the desktop release')
  }
  const artifacts = [check?.artifact, latest?.artifact].filter(Boolean)
  for (const uploaded of uploadedArtifacts) {
    if (
      !artifacts.some(
        (artifact) =>
          artifact?.sha256?.toLowerCase() === uploaded.sha256 &&
          Number(artifact.size) === uploaded.size
      )
    ) {
      throw new Error(`HiveCloud post-publish check omitted artifact ${uploaded.artifactId}`)
    }
  }
  console.log(
    `Published HiveCode Desktop ${versionName} build ${buildNumber} (${platform}/${architecture}) to HiveCloud OSS-backed releases`
  )
}

function hasExpectedVerifiedArtifacts(release, expectedArchitectures) {
  const expectedFormat = platform === 'windows' ? 'NSIS' : platform === 'macos' ? 'ZIP' : 'APPIMAGE'
  const expectedDistribution = channel === 'internal' ? 'INTERNAL' : 'DIRECT'
  const artifacts = Array.isArray(release?.artifacts) ? release.artifacts : []
  return expectedArchitectures.every((expectedArchitecture) =>
    artifacts.some(
      (candidate) =>
        String(candidate?.architecture ?? '').toLowerCase() === expectedArchitecture &&
        String(candidate?.packageFormat ?? '').toUpperCase() === expectedFormat &&
        String(candidate?.distributionType ?? '').toUpperCase() === expectedDistribution &&
        String(candidate?.status ?? '').toUpperCase() === 'VERIFIED'
    )
  )
}

function assertReleaseIdentity(release, buildNumber) {
  if (
    String(release?.productCode ?? release?.product ?? '').toLowerCase() !== 'hivecode' ||
    String(release?.platform ?? '').toLowerCase() !== platform ||
    String(release?.channel ?? '').toLowerCase() !== channel ||
    release?.versionName !== versionName ||
    Number(release?.buildNumber) !== buildNumber
  ) {
    throw new Error('HiveCloud release identity does not match the requested desktop build')
  }
}

function findUploadedArtifact(
  candidates,
  expectedArchitecture,
  expectedFormat,
  expectedDistribution,
  sha256,
  sha512,
  size
) {
  const matches = (Array.isArray(candidates) ? candidates : []).filter(
    (candidate) =>
      String(candidate?.architecture ?? '').toLowerCase() === expectedArchitecture &&
      String(candidate?.packageFormat ?? '').toUpperCase() === expectedFormat &&
      String(candidate?.distributionType ?? '').toUpperCase() === expectedDistribution &&
      String(candidate?.sha256 ?? '').toLowerCase() === sha256 &&
      String(candidate?.sha512 ?? '').toLowerCase() === sha512 &&
      Number(candidate?.fileSize) === size
  )
  if (matches.length !== 1) {
    throw new Error('HiveCloud artifact response did not identify exactly one uploaded artifact')
  }
  return matches[0]
}

async function findOrCreateDraft(buildNumber) {
  const query = new URLSearchParams({
    product: 'hivecode',
    platform: platform.toUpperCase(),
    channel: channel.toUpperCase(),
    limit: '50'
  })
  const existing = await hiveCloudRequest(`/hive/v1/admin/releases?${query}`)
  const match = findReleaseIdentity(existing, buildNumber)
  if (match?.releaseId) {
    return match
  }
  const payload = {
    product: 'hivecode',
    platform: platform.toUpperCase(),
    channel: channel.toUpperCase(),
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
    // Parallel architecture jobs may race to create the platform release. A
    // conflict is safe to recover by re-reading the draft; other failures
    // remain fatal so a broken control plane cannot be hidden.
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
