import assert from 'node:assert/strict'
import test from 'node:test'
import { requestGitHubSmokeTokens } from './github-smoke-token.mjs'

const jwt = (value) => `${value}.${value}.${value}`

test('exchanges the runner OIDC token without returning request credentials', async () => {
  const requests = []
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), init })
    if (requests.length === 1) return Response.json({ value: jwt('github') })
    return Response.json({
      accessTokens: Object.fromEntries(
        ['owner', 'recipient', 'outsider'].map((name) => [
          name,
          { userId: `usr_${name}`, accessToken: jwt(name), expiresAt: Date.now() + 600_000 }
        ])
      )
    })
  }
  const result = await requestGitHubSmokeTokens(
    'https://auth-staging.onorca.dev',
    fetchImpl,
    {
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://actions.example.test/token?api-version=1',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'runner-request-token'
    }
  )
  assert.equal(result.owner.userId, 'usr_owner')
  assert.match(requests[0].url, /audience=https%3A%2F%2Fauth-staging\.onorca\.dev/)
  assert.equal(requests[0].init.headers.authorization, 'Bearer runner-request-token')
  assert.equal(requests[1].init.headers.authorization, `Bearer ${jwt('github')}`)
})

test('fails with bounded errors and never includes credentials', async () => {
  await assert.rejects(
    requestGitHubSmokeTokens(
      'https://auth-staging.onorca.dev',
      async () => new Response('denied', { status: 403 }),
      {
        ACTIONS_ID_TOKEN_REQUEST_URL: 'https://actions.example.test/token',
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'private-request-token'
      }
    ),
    (error) => {
      assert.doesNotMatch(String(error), /private-request-token|denied/)
      return true
    }
  )
})
