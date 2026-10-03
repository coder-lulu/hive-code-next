import { randomUUID } from 'node:crypto'
import { createHook } from 'node:async_hooks'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { produceManagedPiTextPack } from '../build-plugins/managed-pi-pack-producer'
import { loadManagedPiTextPack } from '../../src/main/runtime/managed-pi-pack-loader'
import { createManagedPiTextDriver } from '../../src/main/native-chat/managed-pi-text-driver'
import { createManagedPiTextAdapter } from '../../src/main/native-chat/managed-pi-text-adapter'
import { resolveHiveAgentTextPack } from '../../src/main/native-chat/hive-agent-text-pack'
import {
  openManagedPiProcessSupervisor,
  type ManagedPiExecutionOwnership
} from '../../src/main/runtime/managed-pi-process-supervisor'
import type { ManagedPiInferenceEvent } from '../../src/shared/managed-pi-process-protocol'
import type { ManagedPiTextInference } from '../../src/main/native-chat/managed-pi-inference-pump'

let root: string
let pack: Awaited<ReturnType<typeof loadManagedPiTextPack>>
const disposers: (() => Promise<void>)[] = []
beforeAll(async () => {
  const base = resolve('logs/managed-pi-process-tests')
  await mkdir(base, { recursive: true })
  root = await mkdtemp(join(base, 'Pi IPC with spaces 中文-'))
  const built = await produceManagedPiTextPack(resolve('.'), join(root, 'pack'))
  pack = await loadManagedPiTextPack({ rootDirectory: built.root, indexSha256: built.indexSha256 })
}, 15000)
afterEach(async () => {
  for (const dispose of disposers.splice(0)) {
    await dispose()
  }
})
afterAll(async () => {
  pack?.dispose()
  if (root) {
    await rm(root, { recursive: true, force: true })
  }
})
function ownership() {
  let current = true
  const owner: ManagedPiExecutionOwnership = {
    sessionId: `ha-session:${randomUUID()}`,
    runtimeRecordId: 'actual_pi_host',
    hostId: 'local',
    runtimeFence: 1,
    spawnToken: randomUUID(),
    assertCurrent() {
      if (!current) {
        throw new Error('private revoked')
      }
    },
    onIdentity: vi.fn(async () => {}),
    onExit: vi.fn(async () => {})
  }
  return {
    owner,
    revoke: () => {
      current = false
    }
  }
}
async function fixture(inference?: ManagedPiTextInference, turnTimeoutMs?: number) {
  const { owner, revoke } = ownership()
  const run = vi.fn(
    inference?.run ??
      async function* () {
        yield { type: 'text' as const, text: 'hello' }
        yield { type: 'completed' as const, text: 'hello' }
      }
  )
  const driver = await createManagedPiTextDriver({
    pack,
    ownership: owner,
    home: root,
    inference: { run },
    turnTimeoutMs
  })
  disposers.push(driver.dispose)
  const request = (protocol: 'CHAT_COMPLETIONS' | 'RESPONSES' = 'CHAT_COMPLETIONS') => ({
    sessionId: owner.sessionId,
    generationId: `ha-generation:${randomUUID()}`,
    text: 'owned IPC turn',
    history: [],
    modelSelection: { modelId: 'explicit-model', protocol, snapshotRevision: 'a'.repeat(64) },
    executionBinding: resolveHiveAgentTextPack(pack.readPack, 'personal', protocol).binding,
    launchFiles: pack.getLaunchFiles(),
    signal: new AbortController().signal
  })
  return { driver, owner, revoke, run, request }
}
async function collect(iterable: AsyncIterable<unknown>) {
  const result: unknown[] = []
  for await (const item of iterable) {
    result.push(item)
  }
  return result
}
function present(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
      throw error
    }
    return false
  }
}
it.each(['CHAT_COMPLETIONS', 'RESPONSES'] as const)(
  'executes %s through actual persistent private Pi IPC',
  async (protocol) => {
    const f = await fixture()
    expect(f.owner.onIdentity).toHaveBeenCalledWith(f.driver.identity)
    expect(f.driver.identity).toMatchObject({ hostId: 'local', spawnToken: f.owner.spawnToken })
    expect(present(f.driver.identity.pid)).toBe(true)
    const request = {
      ...f.request(protocol),
      history: [
        { role: 'user' as const, text: 'prior question' },
        { role: 'assistant' as const, text: 'confirmed answer' }
      ]
    }
    expect(await collect(f.driver.run(request))).toEqual([
      { sequence: 1, type: 'text', text: 'hello' },
      { sequence: 2, type: 'completed' }
    ])
    expect(f.run).toHaveBeenCalledWith(
      expect.objectContaining({
        request: {
          requestId: request.generationId.slice('ha-generation:'.length),
          sessionId: request.sessionId,
          generationId: request.generationId,
          ...request.modelSelection,
          messages: [...request.history, { role: 'user', text: request.text }]
        },
        executionBinding: request.executionBinding,
        signal: expect.any(AbortSignal)
      })
    )
    expect(present(f.driver.identity.pid)).toBe(true)
    expect(f.owner.onExit).not.toHaveBeenCalled()
    await f.driver.dispose()
    expect(present(f.driver.identity.pid)).toBe(false)
    expect(f.owner.onExit).toHaveBeenCalledTimes(1)
  }
)
it('uses the same child for successive confirmed turns and the existing P2 adapter', async () => {
  const f = await fixture()
  const adapter = await createManagedPiTextAdapter({
    pack,
    driver: f.driver,
    runtimeRecordId: f.owner.runtimeRecordId
  })
  for (const protocol of ['CHAT_COMPLETIONS', 'RESPONSES'] as const) {
    const { launchFiles: _, ...input } = f.request(protocol)
    expect(await collect(adapter.run(input))).toEqual([
      { sequence: 1, type: 'text', text: 'hello' },
      { sequence: 2, type: 'completed' }
    ])
  }
  expect(f.run).toHaveBeenCalledTimes(2)
  expect(f.owner.onIdentity).toHaveBeenCalledTimes(1)
})
it.each(['session', 'node', 'runner'])('rejects a foreign %s before dispatch', async (kind) => {
  const f = await fixture(),
    request = f.request()
  if (kind === 'session') {
    request.sessionId = `ha-session:${randomUUID()}`
  } else {
    request.launchFiles = { ...request.launchFiles, [kind]: resolve('forbidden') }
  }
  await expect(collect(f.driver.run(request))).rejects.toThrow()
  expect(f.run).not.toHaveBeenCalled()
})
it('does not dispatch a pre-cancelled turn', async () => {
  const f = await fixture(),
    request = f.request(),
    control = new AbortController()
  control.abort()
  request.signal = control.signal
  expect(await collect(f.driver.run(request))).toEqual([])
  expect(f.run).not.toHaveBeenCalled()
})
it.each(['mismatch', 'missing', 'late', 'malformed', 'overflow'])(
  'keeps %s inference evidence UNKNOWN and stops only its child',
  async (mode) => {
    const f = await fixture({
      async *run() {
        yield { type: 'text', text: 'hello' }
        if (mode === 'missing') {
          return
        }
        if (mode === 'malformed') {
          yield { type: 'completed', text: null } as unknown as ManagedPiInferenceEvent
        } else if (mode === 'overflow') {
          yield { type: 'text', text: '汉'.repeat(350000) }
        } else {
          yield { type: 'completed', text: mode === 'mismatch' ? 'different' : 'hello' }
        }
        if (mode === 'late') {
          yield { type: 'text', text: 'late' }
        }
      }
    })
    await expect(collect(f.driver.run(f.request()))).rejects.toThrow(/^hive_agent_outcome_unknown$/)
    expect(present(f.driver.identity.pid)).toBe(false)
    expect(f.owner.onExit).toHaveBeenCalledTimes(1)
  }
)
it.each(['cancel', 'return'])('stops the exact IPC child on consumer %s', async (mode) => {
  let ended = false
  const f = await fixture({
    async *run(input) {
      try {
        yield { type: 'text', text: 'first' }
        await new Promise<void>((resolve) => {
          if (input.signal.aborted) {
            resolve()
          } else {
            input.signal.addEventListener('abort', () => resolve(), { once: true })
          }
        })
      } finally {
        ended = true
      }
    }
  })
  const request = f.request(),
    control = new AbortController()
  request.signal = control.signal
  const iterator = f.driver.run(request)[Symbol.asyncIterator]()
  expect((await iterator.next()).value).toEqual({ sequence: 1, type: 'text', text: 'first' })
  if (mode === 'return') {
    await iterator.return?.()
  } else {
    control.abort()
    await expect(iterator.next()).rejects.toThrow(/^hive_agent_outcome_unknown$/)
  }
  await vi.waitFor(() => expect(ended).toBe(true))
  expect(present(f.driver.identity.pid)).toBe(false)
})
it('bounds a nonterminal turn and retires its driver without retry', async () => {
  const f = await fixture(
    {
      async *run(input) {
        await new Promise<void>((resolve) =>
          input.signal.addEventListener('abort', () => resolve(), { once: true })
        )
        yield { type: 'completed', text: '' }
      }
    },
    1000
  )
  await expect(collect(f.driver.run(f.request()))).rejects.toThrow(/^hive_agent_outcome_unknown$/)
  expect(present(f.driver.identity.pid)).toBe(false)
  await expect(collect(f.driver.run(f.request()))).rejects.toThrow()
  expect(f.run).toHaveBeenCalledTimes(1)
})
it('rechecks execution ownership after streaming resumes', async () => {
  const f = await fixture(),
    iterator = f.driver.run(f.request())[Symbol.asyncIterator]()
  expect((await iterator.next()).value).toMatchObject({ type: 'text' })
  f.revoke()
  await expect(iterator.next()).rejects.toThrow(/^hive_agent_outcome_unknown$/)
  expect(present(f.driver.identity.pid)).toBe(false)
})
it('refuses concurrent generations on one persistent child', async () => {
  const f = await fixture(),
    first = f.driver.run(f.request())[Symbol.asyncIterator]()
  expect((await first.next()).value).toMatchObject({ type: 'text' })
  await expect(collect(f.driver.run(f.request()))).rejects.toThrow()
  await first.return?.()
  expect(f.run).toHaveBeenCalledTimes(1)
})
it('times out startup without committing an unproved identity', async () => {
  const { owner } = ownership()
  await expect(
    openManagedPiProcessSupervisor({ pack, ownership: owner, home: root, startupTimeoutMs: 1 })
  ).rejects.toThrow()
  expect(owner.onIdentity).not.toHaveBeenCalled()
  expect(owner.onExit).toHaveBeenCalledTimes(1)
})
it('rejects a cross-generation command at the actual child boundary', async () => {
  const { owner } = ownership()
  const supervisor = await openManagedPiProcessSupervisor({ pack, ownership: owner, home: root })
  disposers.push(supervisor.dispose)
  await supervisor.transport.send({ type: 'cancel', generationId: `ha-generation:${randomUUID()}` })
  await supervisor.transport.exited
  expect(present(supervisor.identity.pid)).toBe(false)
})
it('requires the parent inference port and local execution ownership', async () => {
  const { owner } = ownership()
  await expect(
    createManagedPiTextDriver({
      pack,
      ownership: owner,
      home: root,
      inference: undefined as unknown as ManagedPiTextInference
    })
  ).rejects.toThrow(/^hive_agent_capability_unavailable$/)
  await expect(
    openManagedPiProcessSupervisor({ pack, ownership: { ...owner, hostId: 'remote' }, home: root })
  ).rejects.toThrow(/^hive_agent_capability_unavailable$/)
  expect(owner.onIdentity).not.toHaveBeenCalled()
})

it.each(['', 'final only'])('accepts a valid final-only result %j over IPC', async (text) => {
  const f = await fixture({
    async *run() {
      yield { type: 'completed', text }
    }
  })
  expect(await collect(f.driver.run(f.request()))).toEqual([
    ...(text ? [{ sequence: 1, type: 'text', text }] : []),
    { sequence: text ? 2 : 1, type: 'completed' }
  ])
})

it('withholds completion until the parent inference iterator actually ends', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let finalSent = false
  const f = await fixture({
    async *run(input) {
      yield { type: 'text', text: 'hello' }
      yield { type: 'completed', text: 'hello' }
      finalSent = true
      await Promise.race([
        gate,
        new Promise<void>((resolve) => {
          input.signal.addEventListener('abort', () => resolve(), { once: true })
        })
      ])
    }
  })
  const iterator = f.driver.run(f.request())[Symbol.asyncIterator]()
  expect((await iterator.next()).value).toMatchObject({ type: 'text' })
  let settled = false
  const terminal = iterator.next().then((event) => {
    settled = true
    return event
  })
  try {
    await vi.waitFor(() => expect(finalSent).toBe(true))
    expect(settled).toBe(false)
    release()
    expect((await terminal).value).toEqual({ sequence: 2, type: 'completed' })
    expect((await iterator.next()).done).toBe(true)
  } finally {
    release()
    await iterator.return?.()
  }
})

it('does not terminate another owned Pi child during cancellation', async () => {
  const first = await fixture(),
    second = await fixture()
  const iterator = first.driver.run(first.request())[Symbol.asyncIterator]()
  await iterator.next()
  await iterator.return?.()
  expect(present(first.driver.identity.pid)).toBe(false)
  expect(present(second.driver.identity.pid)).toBe(true)
  expect(await collect(second.driver.run(second.request()))).toHaveLength(2)
  expect(second.owner.onExit).not.toHaveBeenCalled()
})

it('rejects malformed ownership and inference ports before binding or spawning', async () => {
  const { owner } = ownership()
  await expect(
    openManagedPiProcessSupervisor({
      pack,
      home: root,
      ownership: { ...owner, onExit: undefined } as unknown as ManagedPiExecutionOwnership
    })
  ).rejects.toThrow(/^hive_agent_capability_unavailable$/)
  await expect(
    createManagedPiTextDriver({
      pack,
      home: root,
      ownership: owner,
      inference: { run: 'invalid' } as unknown as ManagedPiTextInference
    })
  ).rejects.toThrow(/^hive_agent_capability_unavailable$/)
  expect(owner.onIdentity).not.toHaveBeenCalled()
  expect(owner.onExit).not.toHaveBeenCalled()
})

it('stops an idle owned child when ownership is observed revoked at admission', async () => {
  const f = await fixture()
  f.revoke()
  await expect(collect(f.driver.run(f.request()))).rejects.toThrow(
    /^hive_agent_capability_unavailable$/
  )
  expect(f.run).not.toHaveBeenCalled()
  await vi.waitFor(() => expect(f.owner.onExit).toHaveBeenCalledTimes(1), { timeout: 4000 })
  expect(present(f.driver.identity.pid)).toBe(false)
})

it('stops an idle child when its independent Pack guard is revoked', async () => {
  const ownPack = await loadManagedPiTextPack({
    rootDirectory: join(root, 'pack', `${process.platform}-${process.arch}`),
    indexSha256: pack.readPack().manifest.packRevision
  })
  const { owner } = ownership()
  try {
    const supervisor = await openManagedPiProcessSupervisor({
      pack: ownPack,
      ownership: owner,
      home: root
    })
    disposers.push(supervisor.dispose)
    ownPack.dispose()
    expect(supervisor.assertCurrent).toThrow(/^hive_agent_capability_unavailable$/)
    await vi.waitFor(() => expect(owner.onExit).toHaveBeenCalledTimes(1), { timeout: 4000 })
    expect(present(supervisor.identity.pid)).toBe(false)
  } finally {
    ownPack.dispose()
  }
})

it.each(['dispose', 'exit', 'timeout'])(
  'aborts parent inference on %s while the consumer remains paused',
  async (mode) => {
    let parentSignal: AbortSignal | undefined
    const f = await fixture(
      {
        async *run(input) {
          parentSignal = input.signal
          yield { type: 'text', text: 'hello' }
          yield { type: 'completed', text: 'hello' }
        }
      },
      mode === 'timeout' ? 1000 : undefined
    )
    const iterator = f.driver.run(f.request())[Symbol.asyncIterator]()
    try {
      expect((await iterator.next()).value).toMatchObject({ type: 'text' })
      expect(parentSignal?.aborted).toBe(false)
      if (mode === 'dispose') {
        await f.driver.dispose()
      } else if (mode === 'exit') {
        expect(present(f.driver.identity.pid)).toBe(true)
        process.kill(f.driver.identity.pid)
      }
      await vi.waitFor(() => expect(f.owner.onExit).toHaveBeenCalledTimes(1), { timeout: 4000 })
      expect(parentSignal?.aborted).toBe(true)
      expect(present(f.driver.identity.pid)).toBe(false)
    } finally {
      await iterator.return?.().catch(() => {})
    }
  }
)

it('does not accumulate unresolved Promise resources across successful IPC exchanges', async () => {
  const { owner } = ownership()
  const supervisor = await openManagedPiProcessSupervisor({ pack, ownership: owner, home: root })
  disposers.push(supervisor.dispose)
  const pending = new Set<number>()
  const hook = createHook({
    init(id, type) {
      if (type === 'PROMISE') {
        pending.add(id)
      }
    },
    promiseResolve(id) {
      pending.delete(id)
    }
  }).enable()
  const counts: number[] = []
  try {
    for (let turn = 0; turn < 5; turn++) {
      await supervisor.verify()
      await new Promise<void>((resolve) => setImmediate(resolve))
      counts.push(pending.size)
    }
    expect(counts.at(-1)! - counts[0]).toBeLessThanOrEqual(2)
  } finally {
    hook.disable()
  }
})

it.each(['cancel', 'timeout'])(
  'stops a final-only generation on %s after parent EOF while consumption is paused',
  async (mode) => {
    let parentEnded = false
    const f = await fixture(
      {
        async *run() {
          yield { type: 'completed', text: 'hello' }
          parentEnded = true
        }
      },
      mode === 'timeout' ? 1000 : undefined
    )
    const request = f.request(),
      control = new AbortController()
    request.signal = control.signal
    const iterator = f.driver.run(request)[Symbol.asyncIterator]()
    try {
      expect((await iterator.next()).value).toEqual({ sequence: 1, type: 'text', text: 'hello' })
      await vi.waitFor(() => expect(parentEnded).toBe(true))
      if (mode === 'cancel') {
        control.abort()
      }
      await vi.waitFor(() => expect(f.owner.onExit).toHaveBeenCalledTimes(1), { timeout: 4000 })
      expect(present(f.driver.identity.pid)).toBe(false)
    } finally {
      await iterator.return?.().catch(() => {})
    }
  },
  10000
)
