import { describe, expect, it, vi } from 'vitest'
import { releaseAuthentication } from './hivecloud-release-auth.mjs'
import { releaseClient } from './hivecloud-release-client.mjs'

const environment = {
  HIVECLOUD_API_URL: 'https://api.example.test',
  HIVECLOUD_API_CLIENT_ID: 'hivecode-release-ci',
  HIVECLOUD_RELEASE_SCOPE: 'plan',
  HIVECODE_COMMIT_SHA: 'a'.repeat(40),
  ACTIONS_ID_TOKEN_REQUEST_URL: 'https://run.actions.githubusercontent.com/oidc?api-version=2.0',
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'runner-request-credential'
}
const batchId = '10000000-0000-4000-8000-000000000001'
const releaseId = '20000000-0000-4000-8000-000000000002'

function requests(session = {}) {
  return vi.fn(async (url) => {
    if (new URL(url).hostname === 'run.actions.githubusercontent.com') {
      return Response.json({ value: 'github-oidc-credential' })
    }
    if (url.endsWith('/release-ci/exchange')) {
      return Response.json({
        code: 200,
        data: {
          accessToken: 'short-release-credential',
          clientId: environment.HIVECLOUD_API_CLIENT_ID,
          expiresIn: 600,
          sourceCommit: environment.HIVECODE_COMMIT_SHA,
          ...session
        }
      })
    }
    return Response.json({ code: 200, data: { batchId } })
  })
}

describe('release CI authentication', () => {
  it('exchanges GitHub OIDC without placing credentials in bodies, URLs or other requests', async () => {
    const request = requests()
    const control = releaseClient(environment, request)
    await control('/hive/v1/admin/release-batches/by-key?product=hivecode&idempotencyKey=test')
    expect(request).toHaveBeenCalledTimes(3)
    const [oidc, exchange, api] = request.mock.calls
    expect(new URL(oidc[0]).searchParams.get('audience')).toBe(
      'https://api.hivekernel.com/hive-release-ci'
    )
    expect(oidc[1].headers.authorization).toBe('Bearer runner-request-credential')
    expect(exchange[0]).toBe('https://api.example.test/hive/v1/auth/release-ci/exchange')
    expect(exchange[1].headers.authorization).toBe('Bearer github-oidc-credential')
    expect(JSON.parse(exchange[1].body)).toEqual({ scope: 'plan' })
    expect(api[1].headers).toMatchObject({
      authorization: 'Bearer short-release-credential',
      clientid: 'hivecode-release-ci'
    })
    for (const [url, options] of request.mock.calls) {
      expect(options.redirect).toBe('error')
      expect(url).not.toContain('credential')
      expect(options.body ?? '').not.toContain('credential')
    }
  })

  it('shares in-flight exchanges and renews before the short session expires', async () => {
    let time = 1000
    const request = requests()
    const authentication = releaseAuthentication(environment, request, () => time)
    const headers = await Promise.all([authentication(), authentication(), authentication()])
    expect(request).toHaveBeenCalledTimes(2)
    expect(headers[0]).toEqual(headers[1])
    time += 539_999
    await authentication()
    expect(request).toHaveBeenCalledTimes(2)
    time += 1
    await authentication()
    expect(request).toHaveBeenCalledTimes(4)
  })

  it.each(['artifact', 'publish'])(
    'binds %s sessions to the selected batch and member',
    async (scope) => {
      const request = requests()
      await releaseAuthentication(
        {
          ...environment,
          HIVECLOUD_RELEASE_SCOPE: scope,
          HIVECLOUD_RELEASE_BATCH_ID: batchId,
          HIVECLOUD_RELEASE_ID: releaseId
        },
        request
      )()
      expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({
        scope,
        batchId,
        ...(scope === 'artifact' ? { releaseId } : {})
      })
    }
  )

  it.each([
    { sourceCommit: 'b'.repeat(40) },
    { clientId: 'human-operator' },
    { expiresIn: 601 },
    { expiresIn: 60 },
    { expiresIn: '600' },
    { accessToken: '' }
  ])('rejects invalid exchange identity %j before a management request', async (session) => {
    const request = requests(session)
    await expect(
      releaseClient(environment, request)('/hive/v1/admin/release-batches')
    ).rejects.toThrow('invalid release CI identity')
    expect(request).toHaveBeenCalledTimes(2)
  })

  it.each([
    { HIVECLOUD_API_CLIENT_ID: '' },
    { HIVECODE_COMMIT_SHA: 'moving-branch' },
    { HIVECLOUD_RELEASE_SCOPE: 'administrator' },
    { HIVECLOUD_RELEASE_SCOPE: 'publish' },
    { HIVECLOUD_RELEASE_SCOPE: 'artifact', HIVECLOUD_RELEASE_BATCH_ID: batchId },
    { ACTIONS_ID_TOKEN_REQUEST_URL: 'https://evil.example/oidc' },
    { ACTIONS_ID_TOKEN_REQUEST_URL: 'http://run.actions.githubusercontent.com/oidc' },
    {
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://user:password@run.actions.githubusercontent.com/oidc'
    },
    { ACTIONS_ID_TOKEN_REQUEST_TOKEN: '' }
  ])('fails incomplete or untrusted CI configuration before requests %j', (override) => {
    const request = vi.fn()
    expect(() => releaseAuthentication({ ...environment, ...override }, request)).toThrow()
    expect(request).not.toHaveBeenCalled()
  })

  it('keeps manual bearer authentication explicit and never falls back to it in a CI scope', async () => {
    const request = requests()
    const manual = releaseAuthentication(
      {
        HIVECLOUD_API_URL: environment.HIVECLOUD_API_URL,
        HIVECLOUD_API_CLIENT_ID: 'operator',
        HIVECLOUD_API_TOKEN: 'manual'
      },
      request
    )
    expect(await manual()).toEqual({ authorization: 'Bearer manual', clientid: 'operator' })
    expect(request).not.toHaveBeenCalled()
    expect(
      await releaseAuthentication({ ...environment, HIVECLOUD_API_TOKEN: 'manual' }, request)()
    ).toMatchObject({
      authorization: 'Bearer short-release-credential'
    })
  })

  it('does not cache failed exchanges or include credentials in errors', async () => {
    const request = requests()
    request.mockImplementationOnce(async () => Response.json({ value: '' }))
    const authentication = releaseAuthentication(environment, request)
    await expect(authentication()).rejects.toThrow('usable OIDC token')
    expect(request).toHaveBeenCalledTimes(1)
    await authentication()
    expect(request).toHaveBeenCalledTimes(3)
  })

  it.each([
    { GITHUB_ACTIONS: 'true' },
    { ACTIONS_ID_TOKEN_REQUEST_URL: environment.ACTIONS_ID_TOKEN_REQUEST_URL },
    { ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'runner-credential' }
  ])('rejects a missing CI scope even when a manual bearer exists %j', (context) => {
    const request = vi.fn()
    expect(() =>
      releaseAuthentication(
        {
          HIVECLOUD_API_URL: environment.HIVECLOUD_API_URL,
          HIVECLOUD_API_CLIENT_ID: 'operator',
          HIVECLOUD_API_TOKEN: 'manual',
          ...context
        },
        request
      )
    ).toThrow('unified release workflow')
    expect(request).not.toHaveBeenCalled()
  })
})
