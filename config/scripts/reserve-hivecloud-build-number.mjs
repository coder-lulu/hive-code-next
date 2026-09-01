#!/usr/bin/env node

import { appendFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const MAX_RESPONSE_BYTES = 1024 * 1024

function required(value, name) {
  const normalized = String(value ?? '').trim()
  if (!normalized) throw new Error(`${name} is required`)
  return normalized
}

async function responseText(response) {
  const length = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw new Error('HiveCloud reservation response is too large')
  }
  if (!response.body) {
    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new Error('HiveCloud reservation response is too large')
    }
    return text
  }
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error('HiveCloud reservation response is too large')
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

export async function reserveHiveCloudBuildNumber(environment = process.env, request = fetch) {
  const apiBase = required(environment.HIVECLOUD_API_URL, 'HIVECLOUD_API_URL').replace(/\/$/, '')
  const token = required(environment.HIVECLOUD_API_TOKEN, 'HIVECLOUD_API_TOKEN')
  const platform = required(
    environment.HIVECODE_RELEASE_PLATFORM,
    'HIVECODE_RELEASE_PLATFORM'
  ).toLowerCase()
  const channel = required(
    environment.HIVECODE_RELEASE_CHANNEL,
    'HIVECODE_RELEASE_CHANNEL'
  ).toLowerCase()
  const reservationKey = required(
    environment.HIVECODE_BUILD_RESERVATION_KEY,
    'HIVECODE_BUILD_RESERVATION_KEY'
  )
  const url = new URL(apiBase)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('HIVECLOUD_API_URL must be an HTTPS URL without credentials or query data')
  }
  if (!['windows', 'macos', 'linux', 'android', 'ios'].includes(platform)) {
    throw new Error(`Unsupported release platform: ${platform}`)
  }
  if (!['internal', 'beta', 'stable'].includes(channel)) {
    throw new Error(`Unsupported release channel: ${channel}`)
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(reservationKey)) {
    throw new Error('HIVECODE_BUILD_RESERVATION_KEY contains unsupported characters')
  }

  const expectedText = String(environment.HIVECODE_EXPECTED_BUILD_NUMBER ?? '').trim()
  const requestedBuildNumber = expectedText ? Number(expectedText) : null
  if (
    requestedBuildNumber !== null &&
    (!Number.isSafeInteger(requestedBuildNumber) || requestedBuildNumber < 1)
  ) {
    throw new Error('HIVECODE_EXPECTED_BUILD_NUMBER must be a positive safe integer')
  }

  const response = await request(`${apiBase}/hive/v1/admin/releases/build-numbers/reserve`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      product: 'hivecode',
      platform,
      channel,
      requestedBuildNumber,
      reservationKey
    })
  })
  const text = await responseText(response)
  let payload
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    throw new Error('HiveCloud reservation response was not valid JSON')
  }
  if (!response.ok) {
    throw new Error(
      `HiveCloud build reservation failed (${response.status}): ${text.slice(0, 300)}`
    )
  }
  const buildNumber = Number(payload?.data?.buildNumber ?? payload?.buildNumber)
  if (!Number.isSafeInteger(buildNumber) || buildNumber < 1) {
    throw new Error('HiveCloud returned an invalid build number')
  }
  if (requestedBuildNumber !== null && buildNumber !== requestedBuildNumber) {
    throw new Error(`HiveCloud reserved build ${buildNumber}, expected ${requestedBuildNumber}`)
  }
  return buildNumber
}

async function main() {
  const buildNumber = await reserveHiveCloudBuildNumber()
  if (process.env.GITHUB_ENV) {
    await appendFile(process.env.GITHUB_ENV, `HIVECODE_BUILD_NUMBER=${buildNumber}\n`, 'utf8')
  }
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `build_number=${buildNumber}\n`, 'utf8')
  }
  console.log(`Reserved HiveCode build number ${buildNumber}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
