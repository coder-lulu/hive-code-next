import { HiveRuntimeClaimPollParams, HiveRuntimeResetIdentityParams } from '../../../../shared/rpc-contract/hive-runtime-cloud-params'
import { defineMethod, type RpcContext } from '../core'
import type { HiveRuntimeCloudControl } from '../../../hive-runtime-cloud/hive-runtime-cloud-control'

function requireLocalControl(context: RpcContext): HiveRuntimeCloudControl {
  if (context.clientKind || context.clientId || context.pairedDeviceId) {
    throw new Error('hive_runtime_cloud_local_only')
  }
  if (!context.hiveRuntimeCloud) {
    throw new Error('hive_runtime_cloud_unavailable')
  }
  return context.hiveRuntimeCloud
}

export const HIVE_RUNTIME_CLOUD_METHODS = [
  defineMethod({
    name: 'cloudRuntime.status',
    params: null,
    handler: (_params, context) => requireLocalControl(context).getLocalRuntimeStatus()
  }),
  defineMethod({
    name: 'cloudRuntime.claim',
    params: null,
    handler: (_params, context) => requireLocalControl(context).beginHeadlessClaim()
  }),
  defineMethod({
    name: 'cloudRuntime.claimPoll',
    params: HiveRuntimeClaimPollParams,
    handler: (params, context) => requireLocalControl(context).pollHeadlessClaim(params.challengeId)
  }),
  defineMethod({
    name: 'cloudRuntime.resetIdentity',
    params: HiveRuntimeResetIdentityParams,
    handler: (_params, context) => requireLocalControl(context).resetCloudIdentity()
  })
]
