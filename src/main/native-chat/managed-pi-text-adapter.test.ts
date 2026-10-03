import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { createManagedPiTextAdapter, type ManagedPiTextDriver } from './managed-pi-text-adapter'
import { textPackManifestFixture } from './hive-agent-text-pack.test-fixture'
import { resolveHiveAgentTextPack } from './hive-agent-text-pack'
import type { HiveAgentTextAdapter, HiveAgentTextEvent } from './hive-agent-text-adapter'

vi.mock('../runtime/managed-pi-runtime-identity', () => ({
  verifyManagedPiRuntimeIdentity: async (pack: {
    readPack: () => { assertCurrent: () => void }
  }) => ({
    assertCurrent: () => pack.readPack().assertCurrent()
  })
}))
type Input = Parameters<HiveAgentTextAdapter['run']>[0]
async function fixture(driver?: ManagedPiTextDriver) {
  const manifest = textPackManifestFixture()
  let revoked = false
  const pack = {
    readPack() {
      return {
        manifest,
        assertCurrent: () => {
          if (revoked) {
            throw new Error('secret revoked')
          }
        }
      }
    },
    getLaunchFiles: () =>
      Object.freeze({ node: resolve('verified/node'), runner: resolve('verified/agent.cjs') }),
    dispose: () => {
      revoked = true
    }
  }
  const run = vi.fn(
    driver?.run ??
      async function* () {
        yield { sequence: 1, type: 'text', text: 'hello' }
        yield { sequence: 2, type: 'completed' }
      }
  )
  const adapter = await createManagedPiTextAdapter({
    pack,
    driver: { run },
    runtimeRecordId: 'managed_pi_record'
  })
  const input: Input = {
    sessionId: `ha-session:${randomUUID()}`,
    generationId: `ha-generation:${randomUUID()}`,
    text: 'test',
    history: [],
    modelSelection: {
      modelId: 'bound-model',
      protocol: 'CHAT_COMPLETIONS',
      snapshotRevision: 'a'.repeat(64)
    },
    executionBinding: resolveHiveAgentTextPack(pack.readPack, 'personal', 'CHAT_COMPLETIONS')
      .binding,
    signal: new AbortController().signal
  }
  return { pack, manifest, run, adapter, input }
}
async function collect(events: ReturnType<HiveAgentTextAdapter['run']>) {
  const result: HiveAgentTextEvent[] = []
  for await (const event of events) {
    result.push(event)
  }
  return result
}
it('keeps the real runtime record binding and freezes the selected execution input', async () => {
  const f = await fixture()
  expect(f.adapter.binding(f.input.sessionId)).toMatchObject({
    providerKind: 'managed-pi',
    runtimeRecordRef: 'managed_pi_record',
    capabilities: ['local.text']
  })
  expect(await collect(f.adapter.run(f.input))).toEqual([
    { sequence: 1, type: 'text', text: 'hello' },
    { sequence: 2, type: 'completed' }
  ])
  const sent = f.run.mock.calls[0][0]
  expect(sent.modelSelection).toEqual(f.input.modelSelection)
  expect(sent.executionBinding).toEqual(f.input.executionBinding)
  expect(sent.launchFiles).toEqual(f.pack.getLaunchFiles())
  expect([sent, sent.modelSelection, sent.executionBinding].every(Object.isFrozen)).toBe(true)
})
it.each(['packRevision', 'profileId', 'protocol', 'maxInputTokens', 'maxOutputTokens'])(
  'rejects a changed execution %s before driver dispatch',
  async (field) => {
    const f = await fixture()
    const changed = {
      ...f.input,
      executionBinding: {
        ...f.input.executionBinding,
        [field]: field.startsWith('max')
          ? 1
          : field === 'packRevision'
            ? 'c'.repeat(64)
            : field === 'protocol'
              ? 'RESPONSES'
              : 'another'
      }
    }
    await expect(collect(f.adapter.run(changed as Input))).rejects.toThrow()
    expect(f.run).not.toHaveBeenCalled()
  }
)
it.each(
  [
    [{ sequence: 2, type: 'text', text: 'gap' }],
    [
      { sequence: 1, type: 'text', text: 'ok' },
      { sequence: 1, type: 'completed' }
    ],
    [{ sequence: 1, type: 'failed' }],
    [{ sequence: 1, type: 'completed', errorMessage: 'secret' }],
    [{ sequence: 1, type: 'text', text: '\ud800' }],
    [{ sequence: 1, type: 'text', text: 'incomplete' }],
    [
      { sequence: 1, type: 'completed' },
      { sequence: 2, type: 'text', text: 'late' }
    ],
    [{ sequence: 1, type: 'text', text: '汉'.repeat(350000) }]
  ].map((events) => ({ events }))
)(
  'rejects invalid or uncertain event streams without fabricating a terminal: %#',
  async ({ events }) => {
    const f = await fixture({
      async *run() {
        yield* events
      }
    })
    await expect(collect(f.adapter.run(f.input))).rejects.toThrow(/^hive_agent_outcome_unknown$/)
  }
)
it('does not dispatch an already cancelled generation', async () => {
  const f = await fixture(),
    control = new AbortController()
  control.abort()
  expect(await collect(f.adapter.run({ ...f.input, signal: control.signal }))).toEqual([])
  expect(f.run).not.toHaveBeenCalled()
})
it('holds completion until the driver finishes its shutdown', async () => {
  let finish!: () => void
  const done = new Promise<void>((resolve) => {
    finish = resolve
  })
  const f = await fixture({
    async *run() {
      yield { sequence: 1, type: 'completed' }
      await done
    }
  })
  let completed = false
  const result = collect(f.adapter.run(f.input)).then((value) => {
    completed = true
    return value
  })
  await vi.waitFor(() => expect(f.run).toHaveBeenCalled())
  expect(completed).toBe(false)
  finish()
  expect(await result).toEqual([{ sequence: 1, type: 'completed' }])
})
it('does not complete when cancellation arrives during driver shutdown', async () => {
  const control = new AbortController()
  const f = await fixture({
    async *run() {
      yield { sequence: 1, type: 'completed' }
      control.abort()
    }
  })
  expect(await collect(f.adapter.run({ ...f.input, signal: control.signal }))).toEqual([])
})
it('revokes late text and completion when the Pack changes during execution', async () => {
  const f = await fixture({
    async *run() {
      f.pack.dispose()
      yield { sequence: 1, type: 'text', text: 'late' }
    }
  })
  await expect(collect(f.adapter.run(f.input))).rejects.toThrow(/^hive_agent_outcome_unknown$/)
})
it('sanitizes thrown runtime diagnostics', async () => {
  const f = await fixture({
    async *run() {
      yield { sequence: 1, type: 'text', text: 'partial' }
      throw new Error('secret credential URL')
    }
  })
  await expect(collect(f.adapter.run(f.input))).rejects.toThrow(/^hive_agent_outcome_unknown$/)
})
it.each(['url', 'credential', 'signal'])(
  'rejects malformed %s input before dispatch',
  async (kind) => {
    const f = await fixture()
    const raw =
      kind === 'url'
        ? { ...f.input, baseUrl: 'https://forbidden.example' }
        : kind === 'credential'
          ? { ...f.input, modelSelection: { ...f.input.modelSelection, apiKey: 'test poison' } }
          : { ...f.input, signal: null }
    await expect(collect(f.adapter.run(raw as Input))).rejects.toThrow(
      /^hive_agent_invalid_request$/
    )
    expect(f.run).not.toHaveBeenCalled()
  }
)
it('keeps a shutdown error after apparent completion uncertain', async () => {
  const f = await fixture({
    async *run() {
      yield { sequence: 1, type: 'completed' }
      throw new Error('uncertain shutdown')
    }
  })
  await expect(collect(f.adapter.run(f.input))).rejects.toThrow(/^hive_agent_outcome_unknown$/)
})
it('closes the driver when the P2 consumer stops reading', async () => {
  let closed = false
  const f = await fixture({
    async *run() {
      try {
        yield { sequence: 1, type: 'text', text: 'first' }
        yield { sequence: 2, type: 'completed' }
      } finally {
        closed = true
      }
    }
  })
  const iterator = f.adapter.run(f.input)[Symbol.asyncIterator]()
  expect((await iterator.next()).value).toEqual({ sequence: 1, type: 'text', text: 'first' })
  await iterator.return?.()
  expect(closed).toBe(true)
})
