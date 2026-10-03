import { expect, it, vi } from 'vitest'
import { createHiveAgentCloudControl } from './hive-agent-cloud-control'
import { controlReply, controlOwner } from '../../shared/hive-ai-text-control.test-fixture'
import { hiveAgentGenerationIdSchema } from '../../shared/hive-agent-session-schema'
import type { parseHiveAiTextControlReply } from '../../shared/hive-ai-text-control'
import { createManagedPiCloudAuthorityResolver } from './managed-pi-cloud-authority'
import { grantCommand } from '../../shared/hive-ai-text-grant.test-fixture'
import { parseHiveAiTextRequest } from '../../shared/hive-ai-text-request'
import { hiveAgentSessionEntrySchema } from '../../shared/hive-agent-session-entry'
import type { AuthenticatedRuntimePrincipal } from '../../shared/hive-agent-session-methods'

function setup() {
  const now = Date.now()
  const request = parseHiveAiTextRequest({
    ...grantCommand.request,
    requestId: grantCommand.request.generationId.slice('ha-generation:'.length)
  })
  const authorization = {
    accountId: controlOwner.accountId,
    authorityId: 'authority',
    accessToken: 'private-token',
    sessionGeneration: 1,
    sessionExpiresAt: now + 120000
  }
  const context = {
    authorityId: 'authority',
    tuple: { ...grantCommand.runtime },
    identity: {
      schemaVersion: 1 as const,
      runtimeInstanceId: grantCommand.runtime.runtimeInstanceId,
      privateKeyPkcs8: 'private-key',
      publicKey: 'public-key',
      createdAt: 1
    }
  }
  const principal: AuthenticatedRuntimePrincipal = {
    kind: 'local',
    ...controlOwner,
    allowedMethods: ['hiveAgent.submit'],
    toolScopes: [],
    projectScope: grantCommand.projectScope,
    expiry: now + 60000,
    eligibilityRevision: 1
  }
  const bindingId = `ha-binding:${request.requestId}`,
    turnId = `ha-turn:${request.requestId}`
  const entry = hiveAgentSessionEntrySchema.parse({
    accountId: controlOwner.accountId,
    deviceId: controlOwner.deviceId,
    projectScope: grantCommand.projectScope,
    aggregate: {
      session: {
        schemaVersion: 1,
        sessionId: request.sessionId,
        profileId: 'personal',
        createdAt: now,
        updatedAt: now,
        visibility: 'private',
        retention: 'until-deleted',
        stateRevision: 1,
        activeGenerationId: request.generationId,
        backendBindingRef: bindingId
      },
      binding: {
        schemaVersion: 1,
        bindingId,
        providerKind: 'managed-pi',
        providerSessionRef: 'managed-pi',
        runtimeRecordRef: 'runtime_record_01',
        capabilityRevision: 1,
        capabilities: ['local.text']
      },
      turn: {
        schemaVersion: 1,
        turnId,
        sessionId: request.sessionId,
        clientOperationId: 'operation',
        inputRef: 'input',
        state: 'RUNNING',
        createdAt: now
      },
      generation: {
        schemaVersion: 1,
        generationId: request.generationId,
        turnId,
        providerBindingRef: bindingId,
        capabilityRevision: 1,
        state: 'RUNNING',
        modelSelection: {
          modelId: request.modelId,
          protocol: request.protocol,
          snapshotRevision: request.snapshotRevision
        }
      }
    }
  })
  let signedIn = true,
    online = true,
    originCurrent = true,
    revision = 1
  const abort = new AbortController()
  const sources = {
    account: { getRuntimeCloudAuthorization: () => (signedIn ? { ...authorization } : null) },
    presence: { getCurrentLeaseContext: () => (online ? structuredClone(context) : null) },
    readSession: () => entry,
    principalForSession: () => principal,
    eligibilityRevision: () => revision,
    assertOrigin: () => {
      if (!originCurrent) {
        throw new Error('private-origin')
      }
    },
    now: () => now
  }
  const resolve = createManagedPiCloudAuthorityResolver(sources)
  return {
    request,
    authorization,
    context,
    principal,
    entry,
    abort,
    resolve,
    sources,
    signOut: () => {
      signedIn = false
    },
    offline: () => {
      online = false
    },
    changeOrigin: () => {
      originCurrent = false
    },
    changeRevision: () => {
      revision++
    }
  }
}

it('combines verified identity and current Runtime without changing persisted state', async () => {
  const test = setup()
  const before = structuredClone(test.entry)
  const resolved = await test.resolve(test.request, test.abort.signal)
  expect(resolved.owner).toEqual(controlOwner)
  expect(resolved.runtime).toEqual(grantCommand.runtime)
  expect(resolved.projectScope).toBe(grantCommand.projectScope)
  expect(Object.isFrozen(resolved.identity)).toBe(true)
  resolved.assertCurrent()
  expect(test.entry).toEqual(before)
})
const mutations: Record<string, (test: ReturnType<typeof setup>) => void> = {
  logout: (test) => test.signOut(),
  offline: (test) => test.offline(),
  origin: (test) => test.changeOrigin(),
  eligibility: (test) => test.changeRevision(),
  cancelled: (test) => test.abort.abort(),
  token: (test) => {
    test.authorization.accessToken = 'different'
  },
  account: (test) => {
    test.authorization.accountId = controlOwner.deviceId
  },
  generation: (test) => {
    test.authorization.sessionGeneration++
  },
  expiry: (test) => {
    test.authorization.sessionExpiresAt = 1
  },
  lease: (test) => {
    test.context.tuple.leaseEpoch++
  },
  runtime: (test) => {
    test.context.tuple.runtimeRecordId = controlOwner.accountId
  },
  key: (test) => {
    test.context.identity.privateKeyPkcs8 = 'different'
  },
  authority: (test) => {
    test.context.authorityId = 'different'
  },
  device: (test) => {
    test.principal.deviceId = controlOwner.accountId
  },
  project: (test) => {
    test.entry.projectScope = 'folder:different'
  },
  deleted: (test) => {
    test.entry.deletedAt = Date.now()
  },
  stopped: (test) => {
    test.entry.aggregate.generation!.state = 'CANCELLED'
  },
  model: (test) => {
    test.entry.aggregate.generation!.modelSelection!.modelId = 'different'
  },
  permission: (test) => {
    test.principal.allowedMethods = []
  }
}
it.each(Object.entries(mutations))(
  'invalidates pinned context after %s changes',
  async (_, mutate) => {
    const test = setup()
    const resolved = await test.resolve(test.request, test.abort.signal)
    mutate(test)
    expect(() => resolved.assertCurrent()).toThrow(/^hive_agent_forbidden$/)
  }
)
it('rejects a request ID that does not belong to the persisted generation', async () => {
  const test = setup()
  await expect(
    test.resolve({ ...test.request, requestId: controlOwner.accountId }, test.abort.signal)
  ).rejects.toThrow('hive_agent_forbidden')
})

it.each(
  (['status', 'cancel'] as const).flatMap((operation) =>
    (['none', 'generation', 'model', 'protocol', 'request', 'logout'] as const).map((fault) => ({
      operation,
      fault
    }))
  )
)(
  'checks remote $operation against current generation without local settlement: $fault',
  async ({ operation, fault }) => {
    const test = setup()
    test.principal.allowedMethods = [
      operation === 'status' ? 'hiveAgent.execution' : 'hiveAgent.cancel'
    ]
    test.entry.aggregate.generation!.state = 'UNKNOWN'
    const reply = {
      ...controlReply,
      requestId: test.request.requestId,
      generationId: test.request.generationId,
      modelId: test.request.modelId,
      protocol: test.request.protocol
    }
    const requested = vi.fn(async () => {
      if (fault === 'logout') {
        test.signOut()
      }
      if (fault === 'generation') {
        reply.generationId = hiveAgentGenerationIdSchema.parse(
          `ha-generation:${controlOwner.accountId}`
        )
      }
      if (fault === 'model') {
        reply.modelId = 'different'
      }
      if (fault === 'protocol') {
        reply.protocol = 'RESPONSES'
      }
      if (fault === 'request') {
        reply.requestId = controlOwner.accountId
      }
      return reply as ReturnType<typeof parseHiveAiTextControlReply>
    })
    const unused = vi.fn()
    const run = createHiveAgentCloudControl({
      sources: test.sources,
      client:
        operation === 'status'
          ? { status: requested, cancel: unused }
          : { status: unused, cancel: requested },
      signal: test.abort.signal
    })
    const before = structuredClone(test.entry)
    if (fault === 'none') {
      expect(await run(test.entry, operation)).toEqual(reply)
    } else {
      await expect(run(test.entry, operation)).rejects.toThrow(
        fault === 'logout' ? 'hive_agent_forbidden' : 'hive_agent_outcome_unknown'
      )
    }
    expect(test.entry).toEqual(before)
    expect(requested).toHaveBeenCalledOnce()
    expect(unused).not.toHaveBeenCalled()
  }
)
