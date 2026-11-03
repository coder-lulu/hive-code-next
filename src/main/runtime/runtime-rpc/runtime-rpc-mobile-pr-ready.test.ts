import { describe, expect, it, vi } from 'vitest'
import { buildRegistry, isStreamingMethod, type RpcContext } from '../rpc/core'
import { GITHUB_PULL_REQUEST_UPDATE_METHODS } from '../rpc/methods/github-pull-request-update-methods'
import { MOBILE_RPC_METHOD_ALLOWLIST } from './runtime-rpc-mobile-method-allowlist'
import { MOBILE_RPC_METHOD_ROUTES } from './runtime-rpc-mobile-method-routing'

const name = 'github.markPRReadyForReview'
const method = buildRegistry(GITHUB_PULL_REQUEST_UPDATE_METHODS).get(name)
if (!method || isStreamingMethod(method)) {
  throw new Error('Ready-review mutation is not registered')
}
const ready = method

describe('mobile ready-review producer coupling', () => {
  it('allows the exact registered workspace mutation on the repository execution host', () => {
    expect(GITHUB_PULL_REQUEST_UPDATE_METHODS.filter((entry) => entry.name === name)).toHaveLength(
      1
    )
    expect(ready.permission).toBe('workspace')
    expect(MOBILE_RPC_METHOD_ROUTES.get(name)).toBe('execution-host')
    expect(MOBILE_RPC_METHOD_ALLOWLIST.has(name)).toBe(true)
    expect(MOBILE_RPC_METHOD_ALLOWLIST.has('github.markPrReadyForReview')).toBe(false)
  })

  it('passes the validated repository, exact pull request and optional fork owner to the existing producer', async () => {
    const result = { completed: true }
    const markRepoPRReadyForReview = vi.fn(async () => result)
    const context = { runtime: { markRepoPRReadyForReview } } as unknown as RpcContext
    const params = ready.params!.parse({
      repo: '/owned/repo',
      prNumber: 17,
      prRepo: { owner: 'fork-owner', repo: 'fork-repo' }
    })
    await expect(ready.handler(params, context)).resolves.toBe(result)
    expect(markRepoPRReadyForReview).toHaveBeenCalledExactlyOnceWith('/owned/repo', 17, {
      owner: 'fork-owner',
      repo: 'fork-repo'
    })
  })

  it('retains request validation and propagates producer refusal instead of claiming success', async () => {
    expect(ready.params!.safeParse({ repo: '/owned/repo', prNumber: 0 }).success).toBe(false)
    expect(ready.params!.safeParse({ prNumber: 17 }).success).toBe(false)
    const refused = new Error('Repository authorization unavailable')
    const markRepoPRReadyForReview = vi.fn(async () => {
      throw refused
    })
    const context = { runtime: { markRepoPRReadyForReview } } as unknown as RpcContext
    const params = ready.params!.parse({ repo: '/owned/repo', prNumber: 17 })
    await expect(ready.handler(params, context)).rejects.toBe(refused)
    expect(markRepoPRReadyForReview).toHaveBeenCalledExactlyOnceWith('/owned/repo', 17, null)
  })
})
