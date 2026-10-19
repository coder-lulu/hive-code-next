import { httpsOrigin, readReleaseResponse } from './hivecloud-release-response.mjs'

const AUDIENCE = 'https://api.hivekernel.com/hive-release-ci'
const EXCHANGE_PATH = '/hive/v1/auth/release-ci/exchange'
const SOURCE_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function releaseAuthentication(environment = process.env, request = fetch, now = Date.now) {
  const origin = httpsOrigin(environment.HIVECLOUD_API_URL, 'HIVECLOUD_API_URL')
  const clientId = String(environment.HIVECLOUD_API_CLIENT_ID ?? '').trim()
  if (!clientId) {
    throw new Error('HIVECLOUD_API_CLIENT_ID is required')
  }
  const token = String(environment.HIVECLOUD_API_TOKEN ?? '').trim()
  const scope = String(environment.HIVECLOUD_RELEASE_SCOPE ?? '').trim()
  const actionsContext =
    environment.GITHUB_ACTIONS === 'true' ||
    Boolean(environment.ACTIONS_ID_TOKEN_REQUEST_URL || environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN)
  if (token && !scope && !actionsContext) {
    return async () => ({ authorization: `Bearer ${token}`, clientid: clientId })
  }
  if (actionsContext && !scope) {
    throw new Error('GitHub CI publication requires the unified release workflow and an OIDC scope')
  }

  const sourceCommit = String(environment.HIVECODE_COMMIT_SHA ?? '').trim()
  if (!SOURCE_PATTERN.test(sourceCommit) || !['plan', 'artifact', 'publish'].includes(scope)) {
    throw new Error('Release CI authentication requires a frozen source SHA and release scope')
  }
  const binding = { scope }
  if (scope !== 'plan') {
    binding.batchId = environment.HIVECLOUD_RELEASE_BATCH_ID
    if (!UUID_PATTERN.test(binding.batchId ?? '')) {
      throw new Error('Release CI authentication requires a valid batch ID')
    }
  }
  if (scope === 'artifact') {
    binding.releaseId = environment.HIVECLOUD_RELEASE_ID
    if (!UUID_PATTERN.test(binding.releaseId ?? '')) {
      throw new Error('Release CI artifact authentication requires a valid release ID')
    }
  }
  let oidcUrl
  try {
    oidcUrl = new URL(environment.ACTIONS_ID_TOKEN_REQUEST_URL)
  } catch {
    throw new Error('GitHub Actions OIDC is unavailable; id-token: write is required')
  }
  if (
    oidcUrl.protocol !== 'https:' ||
    oidcUrl.username ||
    oidcUrl.password ||
    oidcUrl.hash ||
    !oidcUrl.hostname.endsWith('.actions.githubusercontent.com')
  ) {
    throw new Error('The GitHub Actions OIDC request URL is not trusted')
  }
  const requestToken = String(environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN ?? '').trim()
  if (!requestToken) {
    throw new Error('GitHub Actions OIDC request token is unavailable')
  }
  oidcUrl.searchParams.set('audience', AUDIENCE)
  let cached
  let pending
  async function exchange() {
    const issuedAt = now()
    const oidc = await readReleaseResponse(
      await request(oidcUrl.href, {
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
        headers: { authorization: `Bearer ${requestToken}`, accept: 'application/json' }
      })
    )
    if (typeof oidc?.value !== 'string' || !oidc.value || oidc.value.length > 32_768) {
      throw new Error('GitHub Actions did not return a usable OIDC token')
    }
    const session = await readReleaseResponse(
      await request(`${origin}${EXCHANGE_PATH}`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
        headers: {
          authorization: `Bearer ${oidc.value}`,
          accept: 'application/json',
          'content-type': 'application/json'
        },
        body: JSON.stringify(binding)
      })
    )
    if (
      typeof session?.accessToken !== 'string' ||
      !session.accessToken ||
      session.accessToken.length > 8192 ||
      session.clientId !== clientId ||
      session.sourceCommit !== sourceCommit ||
      !Number.isInteger(session.expiresIn) ||
      session.expiresIn <= 60 ||
      session.expiresIn > 600
    ) {
      throw new Error('HiveCloud returned a different or invalid release CI identity')
    }
    cached = {
      headers: { authorization: `Bearer ${session.accessToken}`, clientid: clientId },
      refreshAt: issuedAt + (session.expiresIn - 60) * 1000
    }
  }
  return async () => {
    if (!cached || now() >= cached.refreshAt) {
      pending ??= exchange().finally(() => {
        pending = undefined
      })
      await pending
    }
    return { ...cached.headers }
  }
}
