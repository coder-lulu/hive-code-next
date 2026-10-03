const REQUEST_TIMEOUT_MS = 15_000
const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

export async function requestGitHubSmokeTokens(
  authOrigin,
  fetchImpl = fetch,
  environment = process.env
) {
  const origin = canonicalHttpsOrigin(authOrigin)
  const requestUrl = environment.ACTIONS_ID_TOKEN_REQUEST_URL
  const requestToken = environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  if (!requestUrl || !requestToken) throw new Error('GitHub OIDC request context is unavailable')
  const audience = `${origin}/v1/internal/github-smoke-token`
  const oidcUrl = new URL(requestUrl)
  oidcUrl.searchParams.set('audience', audience)
  const oidcResponse = await fetchImpl(oidcUrl, {
    headers: { authorization: `Bearer ${requestToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  const oidc = await readJson(oidcResponse, 'GitHub OIDC request')
  if (!oidcResponse.ok || !validJwt(oidc.value)) {
    throw new Error(`GitHub OIDC request failed with ${oidcResponse.status}`)
  }
  const exchangeResponse = await fetchImpl(audience, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${oidc.value}`
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  const exchange = await readJson(exchangeResponse, 'Orca smoke identity exchange')
  if (!exchangeResponse.ok) {
    throw new Error(`Orca smoke identity exchange failed with ${exchangeResponse.status}`)
  }
  return {
    ...parseAccessTokens(exchange.accessTokens)
  }
}

function canonicalHttpsOrigin(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('auth origin must be canonical HTTPS')
  }
  return url.origin
}

function validJwt(value) {
  return typeof value === 'string' && value.length <= 8192 && JWT_PATTERN.test(value)
}

function parseAccessTokens(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Orca smoke identity response is malformed')
  }
  const expected = ['outsider', 'owner', 'recipient']
  if (Object.keys(value).sort().join(',') !== expected.join(',')) {
    throw new Error('Orca smoke identity response principals are invalid')
  }
  return Object.fromEntries(
    expected.map((name) => {
      const principal = value[name]
      if (
        !principal ||
        typeof principal !== 'object' ||
        typeof principal.userId !== 'string' ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(principal.userId) ||
        typeof principal.accessToken !== 'string' ||
        !validJwt(principal.accessToken) ||
        typeof principal.expiresAt !== 'number' ||
        principal.expiresAt <= Date.now() ||
        principal.expiresAt > Date.now() + 610_000
      ) {
        throw new Error('Orca smoke identity response principal is malformed')
      }
      return [name, principal]
    })
  )
}

async function readJson(response, label) {
  try {
    return await response.json()
  } catch {
    throw new Error(`${label} did not return JSON`)
  }
}
