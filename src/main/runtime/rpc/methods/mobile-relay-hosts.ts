import { defineMethod, type RpcContext } from '../core'
import {
  MOBILE_RELAY_HOST_WORKTREES_METHOD,
  MOBILE_RELAY_HOSTS_LIST_METHOD,
  MobileRelayHostWorktreesParamsSchema
} from '../../../../shared/mobile-relay-hosts-contract'

function requireCatalog(ctx: RpcContext) {
  if (!ctx.authenticatedAccountRuntimeSessionId || !ctx.mobileRelayHosts) {
    throw new Error('Mobile host catalog is unavailable on this connection')
  }
  return ctx.mobileRelayHosts
}

export const MOBILE_RELAY_HOSTS_METHODS = [
  defineMethod({
    name: MOBILE_RELAY_HOSTS_LIST_METHOD,
    permission: 'workspace',
    params: null,
    handler: (_params, ctx) => requireCatalog(ctx).list()
  }),
  defineMethod({
    name: MOBILE_RELAY_HOST_WORKTREES_METHOD,
    permission: 'workspace',
    params: MobileRelayHostWorktreesParamsSchema,
    handler: async (params, ctx) => requireCatalog(ctx).worktrees(params.hostId)
  })
]
