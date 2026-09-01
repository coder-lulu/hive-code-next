import { AGENT_SESSION_HOST_AUTHORITY_CAPABILITY } from '../../../shared/agent-session-host-authority'
import type { RuntimeCapability } from '../../../shared/protocol-version'
import { RuntimeRpcCallError, runtimeEnvironmentSupportsCapability } from './runtime-rpc-client'
import { isRuntimeCompatBlockError } from './runtime-protocol-compat'

export class RemoteAgentSessionCapabilityUnsupportedError extends Error {
  readonly code = 'capability_unsupported'

  constructor(capability?: RuntimeCapability) {
    super(
      capability
        ? `The remote Runtime Host does not support ${capability}; update the host before using this launch option.`
        : 'The remote Runtime Host does not support this safe agent launch; update the host before using this launch option.'
    )
    this.name = 'RemoteAgentSessionCapabilityUnsupportedError'
  }
}

export async function runRemoteAgentSessionLaunch<TResult>(args: {
  environmentId: string
  hostAuthority?: () => Promise<TResult>
  hostAuthorityCapability?: RuntimeCapability
  hostAuthorityCapabilities?: readonly RuntimeCapability[]
  legacyFallbackPolicy?: 'allow' | 'deny'
  legacy: (options: { skipCompatibilityCheck: boolean }) => Promise<TResult>
}): Promise<TResult> {
  const requiredCapabilities = args.hostAuthorityCapabilities?.length
    ? args.hostAuthorityCapabilities
    : [args.hostAuthorityCapability ?? AGENT_SESSION_HOST_AUTHORITY_CAPABILITY]
  const runLegacy = async (
    skipCompatibilityCheck: boolean,
    unavailableCapability: RuntimeCapability = requiredCapabilities[0]!
  ): Promise<TResult> => {
    if (args.legacyFallbackPolicy === 'deny') {
      throw new RemoteAgentSessionCapabilityUnsupportedError(unavailableCapability)
    }
    return await args.legacy({ skipCompatibilityCheck })
  }
  if (!args.hostAuthority) {
    return await runLegacy(false)
  }
  for (const capability of requiredCapabilities) {
    let supported: boolean
    try {
      supported = await runtimeEnvironmentSupportsCapability(args.environmentId, capability)
    } catch (error) {
      if (isRuntimeCompatBlockError(error)) {
        throw error
      }
      // Why: a failed read-only probe has not launched anything, so preserving
      // the legacy path cannot duplicate an agent and keeps transient upgrades neutral.
      return await runLegacy(true, capability)
    }
    // Why: choose before invoking either path; an ambiguous structured outcome
    // must never trigger a legacy retry that could spawn a duplicate.
    if (!supported) {
      return await runLegacy(true, capability)
    }
  }
  try {
    return await args.hostAuthority()
  } catch (error) {
    if (
      error instanceof RuntimeRpcCallError &&
      (error.code === 'agent_session_legacy_required' || error.code === 'method_not_found')
    ) {
      // Why: both responses prove no structured side effect began: the new host rejected an old
      // lower owner before dispatch, or an old host never recognized the method.
      return await runLegacy(true)
    }
    throw error
  }
}
