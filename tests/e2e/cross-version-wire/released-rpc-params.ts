import { importReleaseCheckoutModule, materializeReleaseCheckout } from './release-checkout'

type ReleasedRpcMethod = {
  name: string
  params: unknown
}

type ReleasedParameterParser = {
  parseParams(request: unknown, method: unknown, meta: unknown): unknown
}

type ReleasedDispatcherModule = {
  prototype: ReleasedParameterParser
}

function isReleasedRpcMethod(value: unknown): value is ReleasedRpcMethod {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof value.name === 'string' &&
    'params' in value
  )
}

function isReleasedDispatcher(value: unknown): value is ReleasedDispatcherModule {
  if (typeof value !== 'function' || !('prototype' in value)) {
    return false
  }
  const prototype: unknown = value.prototype
  return (
    typeof prototype === 'object' &&
    prototype !== null &&
    'parseParams' in prototype &&
    typeof prototype.parseParams === 'function'
  )
}

/** v1.4.186 predates the generated catalog and standalone request parser. */
export async function loadReleasedRpcParams(ref: string) {
  const checkout = await materializeReleaseCheckout(ref)
  const [protocol, registry, dispatcher] = await Promise.all([
    importReleaseCheckoutModule(checkout, 'src/shared/protocol-version.ts'),
    importReleaseCheckoutModule(checkout, 'src/main/runtime/rpc/methods/index.ts'),
    importReleaseCheckoutModule(checkout, 'src/main/runtime/rpc/dispatcher.ts')
  ])
  const methods = registry.ALL_RPC_METHODS
  const capabilities = protocol.RUNTIME_CAPABILITIES
  const constructor = dispatcher.RpcDispatcher
  if (
    !Array.isArray(methods) ||
    !methods.every(isReleasedRpcMethod) ||
    !Array.isArray(capabilities) ||
    !isReleasedDispatcher(constructor)
  ) {
    throw new Error(`Release ${checkout.commit} has no actual RPC registry/parser`)
  }
  const catalog: Record<string, unknown> = {}
  for (const method of methods) {
    catalog[method.name] = method.params
  }
  return {
    commit: checkout.commit,
    capabilities: capabilities.filter((value): value is string => typeof value === 'string'),
    catalog,
    parse: (request: unknown, method: unknown, meta: unknown) => {
      // The historical method uses only its arguments; do not instantiate its live runtime.
      const result = constructor.prototype.parseParams(request, method, meta)
      if (!result || typeof result !== 'object') {
        throw new Error('Released parameter parser returned no result')
      }
      return {
        value: 'value' in result ? result.value : undefined,
        error: 'error' in result ? result.error : undefined
      }
    }
  }
}
