import type { HiveRuntimeCloudControl } from '../../hive-runtime-cloud/hive-runtime-cloud-control'
import type { OrcaRuntimeService } from '../orca-runtime'
import type { OrchestrationSessionCaller } from '../orchestration/orchestration-caller-identity'
import { isRegistrationFencedUnsubscribe, type RpcContext, type RpcRequest } from './core'
import { resolveRpcCallerIdentity } from './rpc-caller-identity'
import type { RpcCallerScope } from './rpc-caller-scope'

export type RpcDispatchStreamingOptions = Pick<
  RpcContext,
  | 'authorizeRequest'
  | 'mobileRelayHosts'
  | 'authenticatedAccountRuntimeSessionId'
  | 'authenticatedAccountOperationCallerKey'
  | 'authenticatedCallerFingerprint'
  | 'connectionId'
  | 'signal'
  | 'deviceSelf'
  | 'peerDesktops'
  | 'clientId'
  | 'pairedDeviceId'
  | 'pairedDeviceParentId'
  | 'caller'
  | 'clientKind'
  | 'clientCapabilities'
  | 'updateClientCapabilities'
  | 'sendBinary'
  | 'registerBinaryStreamHandler'
  | 'registerBinaryMessageHandler'
> & {
  /** What the transport proved the caller may do; absent means this host's owner. */
  callerScope?: RpcCallerScope
  /** Connection cancellation bounds readiness waits without cancelling durable handlers. */
  connectionSignal?: AbortSignal
  /** In-process callers: runs after admission and feature waits, just before the handler; a throw
   *  refuses the call (a plugin revoked while its call waited). */
  beforeInvoke?: () => void
}

export function rpcContextFromTransport(
  runtime: OrcaRuntimeService,
  request: RpcRequest,
  options: RpcDispatchStreamingOptions | undefined,
  orchestrationCaller: OrchestrationSessionCaller | undefined,
  hiveRuntimeCloud?: HiveRuntimeCloudControl
): RpcContext {
  return {
    runtime,
    mobileRelayHosts: options?.mobileRelayHosts,
    hiveRuntimeCloud,
    authorizeRequest: options?.authorizeRequest,
    authenticatedAccountRuntimeSessionId: options?.authenticatedAccountRuntimeSessionId,
    authenticatedAccountOperationCallerKey: options?.authenticatedAccountOperationCallerKey,
    signal: options?.signal,
    deviceSelf: options?.deviceSelf,
    peerDesktops: options?.peerDesktops,
    requestId: request.id,
    connectionId: options?.connectionId,
    // Session tabs always need this fence. COMPAT(terminal request-addressed unsubscribe): terminal only for phones without `requestId`.
    // Capture before middleware yields to a replacement subscribe on the same connection.
    subscriptionRegistrationVersion: isRegistrationFencedUnsubscribe(request.method)
      ? runtime.getSubscriptionRegistrationVersion()
      : undefined,
    clientId: options?.clientId,
    pairedDeviceId: options?.pairedDeviceId,
    pairedDeviceParentId: options?.pairedDeviceParentId,
    caller: resolveRpcCallerIdentity(options),
    clientKind: options?.clientKind,
    clientCapabilities: options?.clientCapabilities,
    updateClientCapabilities: options?.updateClientCapabilities,
    authenticatedCallerFingerprint: options?.authenticatedCallerFingerprint,
    sendBinary: options?.sendBinary,
    registerBinaryStreamHandler: options?.registerBinaryStreamHandler,
    registerBinaryMessageHandler: options?.registerBinaryMessageHandler,
    orchestrationCaller
  }
}
