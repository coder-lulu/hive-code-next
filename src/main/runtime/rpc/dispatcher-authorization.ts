export type RpcRequestAuthority = {
  authenticatedAccountRuntimeSessionId?: string
  authorizeRequest?: (method: string) => boolean
  signal?: AbortSignal
}

export class RpcAuthorizationError extends Error {
  constructor() {
    super('Request is not authorized')
  }
}

/** Transport-owned authority is checked again after asynchronous dispatch preparation. */
export function assertRpcRequestAuthorized(method: string, authority?: RpcRequestAuthority): void {
  if (!authority?.authorizeRequest && !authority?.authenticatedAccountRuntimeSessionId) {
    return
  }
  try {
    if (!authority.signal?.aborted && authority.authorizeRequest?.(method) === true) {
      return
    }
  } catch {
    // Never expose credential-provider errors or treat an unavailable authority as permission.
  }
  throw new RpcAuthorizationError()
}
