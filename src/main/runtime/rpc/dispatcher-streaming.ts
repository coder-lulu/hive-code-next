import { isStreamingMethod, type RpcEnvelopeMeta, type RpcRegistry, type RpcRequest } from './core'
import { errorResponse, successResponse } from './errors'
import { orchestrationMigrationFence } from './orchestration-contract-fence'
import type {
  DurableMutationInvocation,
  OrchestrationMutationExecutor
} from './orchestration-mutation-executor'
import type { OrchestrationLegacyCompatibility } from './orchestration-legacy-compatibility'
import { recordRuntimeFeatureInteraction } from './runtime-feature-interaction'
import type { RpcDispatchStreamingOptions } from './dispatcher-stream-options'
import { mapDispatcherError } from './dispatcher-error-response'
import { parseRpcRequestParams } from './dispatcher-request-parsing'
import { routeDispatcherClientHostedBrowserRpc } from './dispatcher-client-browser-routing'
import { needsLocalCallerFingerprint } from './dispatcher-caller-fingerprint'
import { createDispatcherStreamingFeatureEmitter } from './dispatcher-streaming-feature-emitter'
import type { OrcaRuntimeService } from '../orca-runtime'
import type { HiveRuntimeCloudControl } from '../../hive-runtime-cloud/hive-runtime-cloud-control'

export type DispatcherStreamingDependencies = {
  runtime: OrcaRuntimeService
  registry: RpcRegistry
  orchestrationMutations: OrchestrationMutationExecutor
  legacyOrchestration: OrchestrationLegacyCompatibility
  hiveRuntimeCloud: HiveRuntimeCloudControl | undefined
}

// Streaming dispatch replies through a callback so subscription methods can emit multiple frames.
export async function dispatchStreamingRpc(
  dependencies: DispatcherStreamingDependencies,
  request: RpcRequest,
  reply: (response: string) => void,
  options?: RpcDispatchStreamingOptions
): Promise<void> {
  const { runtime, registry, orchestrationMutations, legacyOrchestration, hiveRuntimeCloud } =
    dependencies
  const meta: RpcEnvelopeMeta = { runtimeId: runtime.getRuntimeId() }
  const method = registry.get(request.method)
  if (!method) {
    reply(
      JSON.stringify(
        errorResponse(request.id, meta, 'method_not_found', `Unknown method: ${request.method}`)
      )
    )
    return
  }

  const migrationFence = orchestrationMigrationFence(request, meta)
  if (migrationFence) {
    reply(JSON.stringify(migrationFence))
    return
  }

  const parsedParams = parseRpcRequestParams(request, method, meta)
  if (parsedParams.error) {
    reply(JSON.stringify(parsedParams.error))
    return
  }

  if (!isStreamingMethod(method)) {
    try {
      const clientHostedBrowser = await routeDispatcherClientHostedBrowserRpc(
        runtime,
        request.method,
        parsedParams.value
      )
      if (clientHostedBrowser.handled) {
        recordRuntimeFeatureInteraction(
          runtime,
          request.method,
          clientHostedBrowser.result,
          undefined,
          request.params
        )
        reply(JSON.stringify(successResponse(request.id, meta, clientHostedBrowser.result)))
        return
      }
      const compatibility = await legacyOrchestration.tryHandle(
        request,
        parsedParams.value,
        options?.signal
      )
      if (compatibility.handled) {
        reply(JSON.stringify(successResponse(request.id, meta, compatibility.result)))
        return
      }
      const effectiveParams = compatibility.params ?? parsedParams.value
      const legacyCoordinator = legacyOrchestration.createCoordinatorInvocation(
        request,
        compatibility.legacyCoordinatorAuthority
      )
      const authenticatedCallerFingerprint =
        options?.authenticatedCallerFingerprint ??
        (needsLocalCallerFingerprint(request, effectiveParams)
          ? orchestrationMutations.getLocalAuthenticatedCallerFingerprint()
          : undefined)
      const invoke = (mutation?: DurableMutationInvocation) => {
        const legacyCoordinatorRunId = legacyCoordinator?.revalidate()
        return method.handler(effectiveParams, {
          runtime,
          hiveRuntimeCloud,
          signal: options?.signal,
          requestId: request.id,
          connectionId: options?.connectionId,
          clientId: options?.clientId,
          pairedDeviceId: options?.pairedDeviceId,
          authenticatedAccountRuntimeSessionId: options?.authenticatedAccountRuntimeSessionId,
          clientKind: options?.clientKind,
          clientCapabilities: options?.clientCapabilities,
          orchestrationCapability: request.orchestrationCapability,
          authenticatedCallerFingerprint:
            mutation?.identity.callerFingerprint ?? authenticatedCallerFingerprint,
          recordMutationReceipt: mutation?.recordReceipt,
          orchestrationMutation: mutation?.identity,
          sendBinary: options?.sendBinary,
          registerBinaryStreamHandler: options?.registerBinaryStreamHandler,
          registerBinaryMessageHandler: options?.registerBinaryMessageHandler,
          legacyCoordinatorRunId,
          legacyCoordinatorAuthority: legacyCoordinator?.authority,
          revalidateLegacyCoordinator: legacyCoordinator?.revalidate,
          orchestrationCompatibilityCallerAuthority:
            compatibility.orchestrationCompatibilityCallerAuthority,
          orchestrationCompatibilityEvidence: request.orchestrationCompatibilityEvidence
        })
      }
      const result = await orchestrationMutations.run(
        request,
        effectiveParams,
        invoke,
        legacyCoordinator?.mutationCallerFingerprint ?? authenticatedCallerFingerprint
      )
      recordRuntimeFeatureInteraction(runtime, request.method, result, undefined, request.params)
      reply(JSON.stringify(successResponse(request.id, meta, result)))
    } catch (error) {
      reply(JSON.stringify(mapDispatcherError(request, meta, error)))
    }
    return
  }

  const { emit, recordedFeatureInteractions } = createDispatcherStreamingFeatureEmitter(
    runtime,
    request,
    meta,
    reply
  )

  try {
    const result = await method.handler(
      parsedParams.value,
      {
        runtime,
        hiveRuntimeCloud,
        signal: options?.signal,
        requestId: request.id,
        connectionId: options?.connectionId,
        clientId: options?.clientId,
        pairedDeviceId: options?.pairedDeviceId,
        authenticatedAccountRuntimeSessionId: options?.authenticatedAccountRuntimeSessionId,
        clientKind: options?.clientKind,
        clientCapabilities: options?.clientCapabilities,
        orchestrationCapability: request.orchestrationCapability,
        sendBinary: options?.sendBinary,
        registerBinaryStreamHandler: options?.registerBinaryStreamHandler,
        registerBinaryMessageHandler: options?.registerBinaryMessageHandler
      },
      emit
    )
    recordRuntimeFeatureInteraction(
      runtime,
      request.method,
      result,
      recordedFeatureInteractions,
      request.params
    )
  } catch (error) {
    reply(JSON.stringify(mapDispatcherError(request, meta, error)))
  }
}
