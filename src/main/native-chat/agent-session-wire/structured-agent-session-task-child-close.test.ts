import { describe, expect, it, vi } from 'vitest'
import {
  AgentSessionAcquisitionRootExitObservedError,
  AgentSessionPreSpawnError
} from './structured-agent-session-adapter'
import { joinStructuredAgentSessionChildClose } from './structured-agent-session-child-close'
import type { StructuredAgentSessionLifetimeContext } from './structured-agent-session-host-lifetime'

function context(closeSession?: () => Promise<boolean>) {
  const commitExecutionOwnerStop = vi.fn(async () => 'unresolved' as const)
  const endExitedChild = vi.fn()
  const record = { taskSource: {}, lease: { runtimeFence: 7, deathEvidence: null } }
  const ctx = {
    deps: {
      adapter: closeSession ? { closeSession } : {},
      store: { getRecord: () => record, tasks: { hasSessionBinding: () => true } },
      logger: { warn: vi.fn() }
    },
    runtimeState: { commitExecutionOwnerStop },
    endExitedChild
  } as unknown as StructuredAgentSessionLifetimeContext
  return { ctx, commitExecutionOwnerStop, endExitedChild }
}

const child = { generation: 'generation-1', fence: 7, phase: 'ready' as const }

describe('Task close across the provider lifecycle split', () => {
  it.each(['no-close', 'root-only', 'processless', 'false'] as const)(
    'keeps execution ownership when provider cleanup yields %s',
    async (proof) => {
      const stop =
        proof === 'no-close'
          ? undefined
          : async () => {
              if (proof === 'root-only') {
                throw new AgentSessionAcquisitionRootExitObservedError(new Error('descendant live'))
              }
              if (proof === 'processless') {
                throw new AgentSessionPreSpawnError(new Error('CLI never spawned'))
              }
              return false
            }
      const rig = context(stop)
      expect(await joinStructuredAgentSessionChildClose(rig.ctx, 'session-1', child)).toBe(
        'unverifiable'
      )
      expect(rig.commitExecutionOwnerStop).not.toHaveBeenCalled()
      expect(rig.endExitedChild).not.toHaveBeenCalled()
    }
  )

  it('requires matching execution-host evidence after complete provider cleanup', async () => {
    const rig = context(async () => true)
    expect(await joinStructuredAgentSessionChildClose(rig.ctx, 'session-1', child)).toBe(
      'unverifiable'
    )
    expect(rig.commitExecutionOwnerStop).toHaveBeenCalledWith('session-1', 7)
    expect(rig.endExitedChild).not.toHaveBeenCalled()
  })

  it('rechecks a Task association exposed while a root-only close is awaited', async () => {
    let associated = false
    const closeSession = vi.fn(async () => {
      associated = true
      throw new AgentSessionAcquisitionRootExitObservedError(new Error('descendant still live'))
    })
    const commitExecutionOwnerStop = vi.fn()
    const endExitedChild = vi.fn()
    const ctx = {
      deps: {
        adapter: { closeSession },
        store: {
          getRecord: () => ({ lease: { runtimeFence: 7, deathEvidence: null } }),
          tasks: { hasSessionBinding: () => associated }
        },
        logger: { warn: vi.fn() }
      },
      runtimeState: { commitExecutionOwnerStop },
      endExitedChild
    } as unknown as StructuredAgentSessionLifetimeContext
    expect(await joinStructuredAgentSessionChildClose(ctx, 'session-1', child)).toBe('unverifiable')
    expect(closeSession).toHaveBeenCalledTimes(2)
    expect(commitExecutionOwnerStop).not.toHaveBeenCalled()
    expect(endExitedChild).not.toHaveBeenCalled()
  })
})
