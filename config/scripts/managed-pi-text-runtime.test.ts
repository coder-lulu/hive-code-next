import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createManagedPiTextAdapter } from '../../src/main/native-chat/managed-pi-text-adapter'
import { resolveHiveAgentTextPack } from '../../src/main/native-chat/hive-agent-text-pack'
import type { HiveAgentTextEvent } from '../../src/main/native-chat/hive-agent-text-adapter'
import { produceManagedPiTextPack } from '../build-plugins/managed-pi-pack-producer'
import { loadManagedPiTextPack } from '../../src/main/runtime/managed-pi-pack-loader'
import { verifyManagedPiRuntimeIdentity } from '../../src/main/runtime/managed-pi-runtime-identity'
import { createManagedPiEnvironment } from '../../src/main/runtime/managed-pi-environment'
import { runProcess } from '../../src/shared/child-process/run-process'

let root: string
let pack: Awaited<ReturnType<typeof loadManagedPiTextPack>>
beforeAll(async () => {
  const base = resolve('logs/managed-pi-text-runtime-tests')
  await mkdir(base, { recursive: true })
  root = await mkdtemp(join(base, '受管 runtime with spaces-'))
  const built = await produceManagedPiTextPack(resolve('.'), join(root, 'managed-pi'))
  pack = await loadManagedPiTextPack({ rootDirectory: built.root, indexSha256: built.indexSha256 })
})
afterAll(async () => {
  pack?.dispose()
  if (root) {
    await rm(root, { recursive: true, force: true })
  }
})
async function scenario(mode: string, protocol = 'CHAT_COMPLETIONS') {
  const files = pack.getLaunchFiles()
  const result = await runProcess({
    program: files.node,
    args: [
      resolve('config/scripts/managed-pi-text-runtime-test-fixture.mjs'),
      files.runner,
      mode,
      protocol
    ],
    cwd: root,
    env: createManagedPiEnvironment(
      { ...process.env, OPENAI_API_KEY: 'POISON', NODE_OPTIONS: 'POISON' },
      root
    ),
    timeoutMs: 10000,
    maxOutputBytes: 8192,
    terminationBarrier: true
  })
  expect(result.code, result.stderr).toBe(0)
  expect(result.stderr).toBe('')
  expect(result.timedOut).toBe(false)
  expect(result.outputTruncated).not.toBe(true)
  return JSON.parse(result.stdout)
}
it('probes the actual bundled Pi and Node identities without inference', async () => {
  const result = await verifyManagedPiRuntimeIdentity(pack)
  expect(result.identity).toMatchObject({
    nodeVersion: process.versions.node,
    piCoreVersion: '0.85.1',
    piAiVersion: '0.85.1',
    platform: process.platform,
    architecture: process.arch,
    toolPolicy: 'empty',
    protocols: ['CHAT_COMPLETIONS', 'RESPONSES']
  })
  expect(result.assertCurrent).not.toThrow()
})
it('feeds actual child Pi events through the P2 adapter with the verified launch binding', async () => {
  const adapter = await createManagedPiTextAdapter({
    pack,
    runtimeRecordId: 'owned_pi_record',
    driver: {
      async *run(input) {
        const { launchFiles, signal, ...request } = input
        const result = await runProcess({
          program: launchFiles.node,
          args: [
            resolve('config/scripts/managed-pi-text-runtime-test-fixture.mjs'),
            launchFiles.runner,
            'adapter',
            input.modelSelection.protocol,
            JSON.stringify(request)
          ],
          cwd: root,
          env: createManagedPiEnvironment(process.env, root),
          signal,
          timeoutMs: 10000,
          maxOutputBytes: 8192,
          terminationBarrier: true
        })
        expect(result.code, result.stderr).toBe(0)
        const response = JSON.parse(result.stdout)
        expect(response.error).toBeUndefined()
        expect(response.calls).toBe(1)
        expect(response.networkAttempts).toBe(0)
        yield* response.events
      }
    }
  })
  const input = {
    sessionId: `ha-session:${randomUUID()}`,
    generationId: `ha-generation:${randomUUID()}`,
    text: 'owned adapter turn',
    history: [],
    modelSelection: {
      modelId: 'explicit-model',
      protocol: 'RESPONSES' as const,
      snapshotRevision: 'a'.repeat(64)
    },
    executionBinding: resolveHiveAgentTextPack(pack.readPack, 'personal', 'RESPONSES').binding,
    signal: new AbortController().signal
  }
  expect(adapter.binding(input.sessionId).runtimeRecordRef).toBe('owned_pi_record')
  const events: HiveAgentTextEvent[] = []
  for await (const event of adapter.run(input)) {
    events.push(event)
  }
  expect(events).toEqual([
    { sequence: 1, type: 'text', text: 'hello' },
    { sequence: 2, type: 'completed' }
  ])
})
it.each(['CHAT_COMPLETIONS', 'RESPONSES'])(
  'uses real Pi to map one fixed %s turn',
  async (protocol) => {
    expect(await scenario('complete', protocol)).toMatchObject({
      calls: 1,
      text: 'hello',
      terminal: 'completed',
      sequences: [1, 2],
      networkAttempts: 0
    })
  }
)
it('projects a final-only response before completion', async () => {
  expect(await scenario('final-only')).toMatchObject({
    text: 'final',
    terminal: 'completed',
    sequences: [1, 2]
  })
})
it.each(['empty', 'empty-no-blocks'])(
  'accepts a genuinely %s successful response',
  async (mode) => {
    expect(await scenario(mode)).toMatchObject({
      textEvents: 0,
      text: '',
      terminal: 'completed',
      sequences: [1]
    })
  }
)
it.each([
  'final-null-text',
  'final-missing-text',
  'error-final-stop',
  'done-reason-mismatch',
  'final-without-terminal',
  'thinking-no-start',
  'tool-no-start'
])('rejects malformed raw or final evidence %s', async (mode) => {
  const result = await scenario(mode)
  expect(result.error).toBe('hive_agent_outcome_unknown')
  expect(result.terminal).not.toBe('completed')
  expect(result.calls).toBe(1)
})
it.each([
  'mismatch',
  'empty-mismatch',
  'wrong-model',
  'thinking',
  'tool',
  'error',
  'length',
  'throw',
  'overflow',
  'event-limit',
  'mutate-model'
])('keeps %s uncertain without completion, retries or raw diagnostics', async (mode) => {
  const result = await scenario(mode)
  expect(result.error).toBe('hive_agent_outcome_unknown')
  expect(result.terminal).not.toBe('completed')
  expect(result.calls).toBe(1)
  expect(result.networkAttempts).toBe(0)
  if (mode === 'event-limit') {
    expect(result.textEvents).toBe(999)
  }
})
it.each(['cancel', 'return'])('aborts real Pi when the consumer requests %s', async (mode) => {
  expect(await scenario(mode)).toMatchObject({
    calls: 1,
    aborted: true,
    textEvents: 1,
    terminal: 'text'
  })
})
it('never starts inference after cancellation before dispatch', async () => {
  expect(await scenario('pre-cancel')).toMatchObject({ calls: 0, textEvents: 0 })
})
it('requires the explicit stream instead of using a provider default', async () => {
  expect(await scenario('missing-stream')).toMatchObject({
    calls: 0,
    error: 'hive_agent_invalid_request'
  })
})
it('backpressures Pi while a projected text event is waiting for its consumer', async () => {
  expect(await scenario('backpressure')).toMatchObject({
    text: 'hello world',
    secondReads: 1,
    terminal: 'completed',
    sequences: [1, 2, 3]
  })
})

it.each(['CHAT_COMPLETIONS', 'RESPONSES'])(
  'passes confirmed history through bundled Pi: %s',
  async (protocol) => {
    expect(await scenario('history', protocol)).toMatchObject({
      calls: 1,
      terminal: 'completed',
      networkAttempts: 0
    })
  }
)
