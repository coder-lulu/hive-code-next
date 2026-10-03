import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServerAdapter } from './paperclip-runtime-adapter'
import { hiveRuntimeSessionCodec } from './paperclip-adapter-contract'
import { taskAdapterFixture } from './task-adapter.test-fixture'

let fixture: Awaited<ReturnType<typeof taskAdapterFixture>> | undefined
afterEach(async () => {
  await fixture?.close()
  fixture = undefined
  vi.unstubAllEnvs()
})

describe('hive_runtime external adapter execution', () => {
  it('resolves a binding and registers cancellation before dispatch, then waits beyond acceptance', async () => {
    fixture = await taskAdapterFixture()
    const current = fixture
    const order: string[] = []
    current.ports.resolveBinding = vi.fn(async () => {
      order.push('binding')
      return current.binding
    })
    current.context.onCancellationReady = vi.fn(async () => {
      order.push('ready')
    })
    current.context.onDispatch = vi.fn(() => {
      order.push('dispatch')
    })
    let notifyRunning!: () => void
    const running = new Promise<void>((resolve) => {
      notifyRunning = resolve
    })
    current.context.onLog = vi.fn(async () => {
      notifyRunning()
    })
    let settled = false
    const execution = createServerAdapter(async () => current.ports)
      .execute(current.context)
      .then((result) => {
        settled = true
        return result
      })
    await running
    expect(order).toEqual(['binding', 'ready', 'dispatch'])
    expect(settled).toBe(false)
    current.deps.collect = vi.fn(async () => ({
      outcomeRef: 'outcome:test',
      artifactRefs: ['artifact:report']
    }))
    const result = await execution
    expect(result.exitCode).toBe(0)
    expect(result.costUsd).toBeNull()
    expect(result.usageBasis).toBeNull()
    expect(result.resultJson?.artifactRefs).toEqual(['artifact:report'])
    expect(result.sessionParams).not.toHaveProperty('authorizationRef')
    expect(result.sessionParams).not.toHaveProperty('secret')
    expect(JSON.stringify(result)).not.toContain('Private fixture input')
  })
  it('forwards operator cancellation and returns only the proved host terminal result', async () => {
    fixture = await taskAdapterFixture()
    const current = fixture
    let notifyRunning!: () => void
    const running = new Promise<void>((resolve) => {
      notifyRunning = resolve
    })
    current.context.onLog = vi.fn(async () => {
      notifyRunning()
    })
    const execution = createServerAdapter(async () => current.ports).execute(current.context)
    await running
    current.controller.abort()
    const result = await execution
    expect(result.resultJson?.status).toBe('cancelled')
    expect(result.resultJson?.stopProofRef).toBeTruthy()
    expect(result.signal).toBe('SIGTERM')
    expect(current.deps.stop).toHaveBeenCalledTimes(1)
  })
  it('does not fabricate cancellation when the signal was already aborted before start', async () => {
    fixture = await taskAdapterFixture()
    const current = fixture
    current.controller.abort()
    const result = await createServerAdapter(async () => current.ports).execute(current.context)
    expect(result.errorCode).toBe('OUTCOME_UNKNOWN')
    expect(current.deps.launch).not.toHaveBeenCalled()
    expect(current.store.tasks.get(current.binding.command)).toBeNull()
  })
  it('does not start after dispatch reporting synchronously observes cancellation', async () => {
    fixture = await taskAdapterFixture()
    const current = fixture
    current.context.onDispatch = vi.fn(() => {
      current.controller.abort()
    })
    const result = await createServerAdapter(async () => current.ports).execute(current.context)
    expect(result.errorCode).toBe('OUTCOME_UNKNOWN')
    expect(current.deps.launch).not.toHaveBeenCalled()
  })
  it('reports its wait timeout only after attempting a real host cancellation', async () => {
    fixture = await taskAdapterFixture()
    const current = fixture
    current.ports.waitTimeoutMs = 0
    const result = await createServerAdapter(async () => current.ports).execute(current.context)
    expect(result.timedOut).toBe(true)
    expect(result.resultJson?.status).toBe('cancelled')
    expect(current.store.tasks.get(current.binding.command)?.cancellationKey).toBeTruthy()
    expect(current.deps.stop).toHaveBeenCalledTimes(1)
  })
  it('retains unknown cancellation and its durable references without claiming provider stop', async () => {
    fixture = await taskAdapterFixture()
    const current = fixture
    current.ports.waitTimeoutMs = 60
    current.deps.stop = vi.fn(async () => null)
    let notifyRunning!: () => void
    const running = new Promise<void>((resolve) => {
      notifyRunning = resolve
    })
    current.context.onLog = vi.fn(async () => {
      notifyRunning()
    })
    const execution = createServerAdapter(async () => current.ports).execute(current.context)
    await running
    current.controller.abort()
    const result = await execution
    expect(result.exitCode).toBeNull()
    expect(result.errorCode).toBe('OUTCOME_UNKNOWN')
    expect(result.sessionParams?.executionId).toBe(current.binding.command.executionId)
    expect(current.store.tasks.get(current.binding.command)?.result).toBeNull()
  })
  it.each([
    'runtimeCommandSpec',
    'executionTarget',
    'runtimeMcp',
    'runtimeTools',
    'authToken'
  ] as const)('refuses a Paperclip %s materialization path before dispatch', async (field) => {
    fixture = await taskAdapterFixture()
    const current = fixture
    const result = await createServerAdapter(async () => current.ports).execute({
      ...current.context,
      [field]: 'unbound'
    })
    expect(result.errorCode).toBe('CAPABILITY_UNAVAILABLE')
    expect(current.context.onDispatch).not.toHaveBeenCalled()
    expect(current.deps.launch).not.toHaveBeenCalled()
  })
  it('rejects a binding from another company or run before launch', async () => {
    fixture = await taskAdapterFixture()
    const current = fixture
    current.ports.resolveBinding = vi.fn(async () => ({
      ...current.binding,
      paperclipCompanyId: 'company:other'
    }))
    const result = await createServerAdapter(async () => current.ports).execute(current.context)
    expect(result.errorCode).toBe('FORBIDDEN')
    expect(current.deps.launch).not.toHaveBeenCalled()
  })
  it('keeps the external factory unavailable when its authenticated bridge is absent', async () => {
    vi.stubEnv('HIVE_TASK_TRANSPORT_DESCRIPTOR', undefined)
    const adapter = createServerAdapter()
    expect(adapter.type).toBe('hive_runtime')
    expect((await adapter.testEnvironment({})).status).toBe('fail')
  })
  it('serializes only opaque execution references and supports unbound codec calls', async () => {
    fixture = await taskAdapterFixture()
    const current = fixture
    current.deps.collect = vi.fn(async () => ({
      outcomeRef: 'outcome:test',
      artifactRefs: ['artifact:report']
    }))
    const result = await createServerAdapter(async () => current.ports).execute(current.context)
    const { serialize, deserialize } = hiveRuntimeSessionCodec
    expect(deserialize(serialize(result.sessionParams ?? null))).toEqual(result.sessionParams)
    expect(serialize({ ...result.sessionParams, secret: 'provider-secret' })).toBeNull()
  })
})
