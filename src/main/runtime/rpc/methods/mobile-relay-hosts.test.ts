import { expect, it, vi } from 'vitest'
import { buildRegistry, isStreamingMethod, type RpcContext } from '../core'
import { MOBILE_RELAY_HOSTS_METHODS } from './mobile-relay-hosts'
import {
  MOBILE_RELAY_HOSTS_LIST_METHOD,
  MOBILE_RELAY_HOST_WORKTREES_METHOD
} from '../../../../shared/mobile-relay-hosts-contract'

const registry = buildRegistry(MOBILE_RELAY_HOSTS_METHODS)
function invoke(name: string, context: Partial<RpcContext>, params: unknown = null) {
  const method = registry.get(name)!
  if (isStreamingMethod(method)) {
    throw new Error('Expected unary catalog method')
  }
  return method.handler(params, context as RpcContext)
}
it('refuses absent catalog and unauthenticated contexts instead of a fabricated empty list', () => {
  expect(() => invoke(MOBILE_RELAY_HOSTS_LIST_METHOD, {})).toThrow('unavailable')
  expect(() =>
    invoke(MOBILE_RELAY_HOSTS_LIST_METHOD, { authenticatedAccountRuntimeSessionId: 'session' })
  ).toThrow('unavailable')
  expect(() =>
    invoke(MOBILE_RELAY_HOSTS_LIST_METHOD, {
      mobileRelayHosts: { list: vi.fn(), worktrees: vi.fn() }
    })
  ).toThrow('unavailable')
})
it('uses the installed catalog only under the authenticated account transport', async () => {
  const listing = { hosts: [] }
  const list = vi.fn(() => listing)
  const worktrees = vi.fn(async () => ({ worktrees: null }))
  const ctx = {
    authenticatedAccountRuntimeSessionId: 'session',
    mobileRelayHosts: { list, worktrees }
  }
  expect(invoke(MOBILE_RELAY_HOSTS_LIST_METHOD, ctx)).toBe(listing)
  await invoke(MOBILE_RELAY_HOST_WORKTREES_METHOD, ctx, { hostId: 'runtime:known' })
  expect(worktrees).toHaveBeenCalledWith('runtime:known')
})
