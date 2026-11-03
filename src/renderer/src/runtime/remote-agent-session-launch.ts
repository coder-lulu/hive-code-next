import { translate } from '@/i18n/i18n'
import { AGENT_SESSION_HOST_AUTHORITY_CAPABILITY } from '../../../shared/agent-session-host-authority'
import type { RuntimeCapability } from '../../../shared/protocol-version'
import { RuntimeRpcCallError } from './runtime-rpc-result'
import { runtimeEnvironmentSupportsCapability } from './runtime-rpc-client'
import { isRuntimeCompatBlockError } from './runtime-protocol-compat'

export async function runRemoteAgentSessionLaunch<TResult>(args: {
  environmentId: string
  hostAuthority?: () => Promise<TResult>
  hostAuthorityCapability?: RuntimeCapability
  hostAuthorityCapabilities?: readonly RuntimeCapability[]
  legacyFallbackPolicy?: 'allow' | 'deny'
  legacy: (options: { skipCompatibilityCheck: boolean }) => Promise<TResult>
}): Promise<TResult> {
  const fallback = async (skipCompatibilityCheck: boolean): Promise<TResult> => {
    if (args.legacyFallbackPolicy === 'deny') {
      throw new RuntimeRpcCallError({
        id: 'agent-session-capability',
        ok: false,
        error: {
          code: 'capability_unsupported',
          message: translate(
            'auto.runtime.remote.agent.session.launch.1396c15042',
            'The host cannot safely apply this agent launch. Update the host and try again.'
          )
        }
      })
    }
    return await args.legacy({ skipCompatibilityCheck })
  }
  if (!args.hostAuthority) {
    return await fallback(false)
  }
  let supported: boolean
  try {
    const capabilities = [
      ...new Set([
        ...(args.hostAuthorityCapabilities ?? []),
        args.hostAuthorityCapability ?? AGENT_SESSION_HOST_AUTHORITY_CAPABILITY
      ])
    ]
    supported = true
    for (const capability of capabilities) {
      if (!(await runtimeEnvironmentSupportsCapability(args.environmentId, capability))) {
        supported = false
      }
    }
  } catch (error) {
    if (isRuntimeCompatBlockError(error)) {
      throw error
    }
    // Read-only probe failure launched nothing; legacy fallback is safe from duplication during transient upgrades.
    return await fallback(true)
  }
  // Choose before launching: ambiguous structured outcomes must never retry legacy and duplicate agents.
  if (!supported) {
    return await fallback(true)
  }
  try {
    return await args.hostAuthority()
  } catch (error) {
    if (
      error instanceof RuntimeRpcCallError &&
      (error.code === 'agent_session_legacy_required' || error.code === 'method_not_found')
    ) {
      // Both refusals prove no dispatch: new host rejected old ownership or old host did not recognize the method.
      return await fallback(true)
    }
    throw error
  }
}
