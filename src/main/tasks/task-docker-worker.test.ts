import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  attachTaskDockerWorkerInput,
  startTaskDockerWorker,
  taskDockerCodexProcessSpec
} from './task-docker-worker'
import { createTaskDockerModelRpc } from './task-docker-model-rpc'
import { createTaskDockerWorkerOutput } from './task-docker-worker-output'

const streams: PassThrough[] = []
afterEach(() => {
  for (const stream of streams.splice(0)) {
    stream.destroy()
  }
})

function inputFixture(providerHighWaterMark?: number) {
  const input = new PassThrough()
  const providerInput = new PassThrough({ highWaterMark: providerHighWaterMark })
  const output = new PassThrough({ highWaterMark: 1 })
  streams.push(input, providerInput, output)
  let closed = false
  const onFailure = vi.fn(() => {
    closed = true
  })
  const writer = createTaskDockerWorkerOutput({ output, onFailure })
  const modelRpc = createTaskDockerModelRpc({ write: writer.write, onFailure })
  attachTaskDockerWorkerInput({
    input,
    providerInput,
    output: writer,
    modelRpc,
    onFailure,
    isClosed: () => closed
  })
  return { input, providerInput, output, onFailure, modelRpc }
}

describe('task Docker worker stream input', () => {
  it('consumes only exact private responses before applying the ordinary provider guard', async () => {
    const f = inputFixture()
    f.output.resume()
    const sent: string[] = []
    f.providerInput.on('data', (chunk) => sent.push(chunk.toString()))
    const privateFrames: string[] = []
    f.output.on('data', (chunk) => privateFrames.push(chunk.toString()))
    const pending = f.modelRpc.request('hive/model/start', {
      requestId: 'synthetic',
      bodyBase64: 'e30='
    })
    await vi.waitFor(() => expect(privateFrames).toHaveLength(1))
    const id = JSON.parse(privateFrames[0]!).id
    f.input.write(
      `${JSON.stringify({ id, result: { status: 200 } })}\n{"id":1,"method":"initialize"}\n`
    )
    await expect(pending).resolves.toEqual({ status: 200 })
    expect(sent.map((value) => JSON.parse(value))).toEqual([{ id: 1, method: 'initialize' }])
    expect(f.onFailure).not.toHaveBeenCalled()
  })

  it('does not forward a forged private prefix response or its following ordinary request', () => {
    const f = inputFixture()
    f.providerInput.resume()
    const sent = vi.fn()
    f.providerInput.on('data', sent)
    f.input.write('{"id":"hive-model-forged","result":{}}\n{"id":1,"method":"initialize"}\n')
    expect(sent).not.toHaveBeenCalled()
    expect(f.onFailure).toHaveBeenCalledTimes(1)
  })

  it('waits for both independent pipe drains while preserving request order', async () => {
    const f = inputFixture(1)
    f.input.write(
      [
        { id: 1, method: 'initialize' },
        { id: 2, method: 'config/value/write' },
        { id: 3, method: 'initialized' }
      ]
        .map((value) => `${JSON.stringify(value)}\n`)
        .join('')
    )
    expect(f.input.isPaused()).toBe(true)
    expect(f.output.readableLength).toBe(0)
    const sent: string[] = []
    f.providerInput.on('data', (chunk) => sent.push(chunk.toString()))
    await vi.waitFor(() => expect(f.output.readableLength).toBeGreaterThan(0))
    expect(sent).toHaveLength(1)
    expect(f.input.isPaused()).toBe(true)
    f.output.resume()
    await vi.waitFor(() => expect(sent).toHaveLength(2))
    expect(sent.map((value) => JSON.parse(value).id)).toEqual([1, 3])
    expect(f.onFailure).not.toHaveBeenCalled()
  })

  it('bounds rejected output and waits for stdout drain before forwarding the next RPC', async () => {
    const f = inputFixture()
    const sent: string[] = []
    f.providerInput.on('data', (chunk) => sent.push(chunk.toString()))
    const refused = Array.from({ length: 20 }, (_, id) =>
      JSON.stringify({ id, method: 'config/value/write' })
    )
    f.input.write(`${[...refused, JSON.stringify({ id: 21, method: 'initialize' })].join('\n')}\n`)
    expect(f.input.isPaused()).toBe(true)
    expect(f.output.readableLength).toBeLessThan(256)
    expect(sent).toEqual([])
    const responses: string[] = []
    f.output.on('data', (chunk) => responses.push(chunk.toString()))
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(JSON.parse(sent[0]!)).toEqual({ id: 21, method: 'initialize' })
    expect(responses).toHaveLength(20)
    expect(f.onFailure).not.toHaveBeenCalled()
  })

  it('does not reflect oversized or noninteger invalid request IDs into its output', () => {
    const f = inputFixture()
    f.input.write(`${JSON.stringify({ id: 'x'.repeat(8192), method: 'config/value/write' })}\n`)
    f.input.write(`${JSON.stringify({ id: 1.5, method: 'config/value/write' })}\n`)
    expect(f.output.readableLength).toBe(0)
    expect(f.output.writableLength).toBe(0)
    expect(f.onFailure).not.toHaveBeenCalled()
  })

  it('preserves queued complete requests when EOF arrives before output has drained', async () => {
    const f = inputFixture()
    const sent: string[] = []
    f.providerInput.on('data', (chunk) => sent.push(chunk.toString()))
    f.input.end(
      `${JSON.stringify({ id: 1, method: 'config/value/write' })}\n${JSON.stringify({
        id: 2,
        method: 'initialize'
      })}\n`
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(f.providerInput.writableEnded).toBe(false)
    f.output.resume()
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    await vi.waitFor(() => expect(f.providerInput.writableEnded).toBe(true))
    expect(JSON.parse(sent[0]!)).toEqual({ id: 2, method: 'initialize' })
    expect(f.onFailure).not.toHaveBeenCalled()
  })
})

describe('task Docker worker process', () => {
  it('uses only a fixed Linux binary and isolated account home', () => {
    expect(taskDockerCodexProcessSpec()).toEqual({
      program: '/opt/codex/bin/codex',
      args: ['app-server', '-c', 'sandbox_mode="workspace-write"', '-c', 'approval_policy="never"'],
      cwd: '/workspace',
      env: {
        PATH: '/usr/local/bin:/usr/bin:/bin',
        HOME: '/home/hive',
        CODEX_HOME: '/home/hive/.codex',
        ORCA_BACKGROUND_LAUNCH: '1'
      }
    })
  })

  it('does not inherit parent provider credentials or Docker options', () => {
    const original = process.env.HIVE_DOCKER_TEST_PARENT_SECRET
    process.env.HIVE_DOCKER_TEST_PARENT_SECRET = 'synthetic-parent-only'
    try {
      expect(taskDockerCodexProcessSpec().env).not.toHaveProperty('HIVE_DOCKER_TEST_PARENT_SECRET')
      expect(taskDockerCodexProcessSpec().env).not.toHaveProperty('DOCKER_HOST')
      expect(taskDockerCodexProcessSpec().env).not.toHaveProperty('OPENAI_API_KEY')
    } finally {
      if (original === undefined) {
        delete process.env.HIVE_DOCKER_TEST_PARENT_SECRET
      } else {
        process.env.HIVE_DOCKER_TEST_PARENT_SECRET = original
      }
    }
  })

  it('refuses to start the container worker on the desktop host', async () => {
    if (process.platform !== 'linux' || process.getuid?.() !== 1000) {
      await expect(startTaskDockerWorker()).rejects.toThrow('TASK_DOCKER_PLATFORM_UNAVAILABLE')
    }
  })
})
