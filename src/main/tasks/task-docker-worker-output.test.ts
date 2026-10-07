import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  attachTaskDockerWorkerOutput,
  createTaskDockerWorkerOutput
} from './task-docker-worker-output'
import { TASK_MODEL_IDLE_TIMEOUT_MS, TASK_MODEL_RPC_ID_PREFIX } from './task-model-channel-protocol'
import { NDJSON_MAX_LINE_BYTES } from '../../shared/main-process-ndjson-framer'

const streams: PassThrough[] = []
afterEach(() => {
  for (const stream of streams.splice(0)) {
    stream.destroy()
  }
  vi.useRealTimers()
})
function fixture(highWaterMark = 1) {
  const output = new PassThrough({ highWaterMark })
  const provider = new PassThrough()
  streams.push(output, provider)
  const onFailure = vi.fn()
  const writer = createTaskDockerWorkerOutput({ output, onFailure })
  const { completed } = attachTaskDockerWorkerOutput({
    providerOutput: provider,
    write: writer.write,
    onFailure,
    isClosed: () => false
  })
  return { output, provider, writer, completed, onFailure }
}

describe('one complete guest output stream', () => {
  it('never interleaves a private complete frame with a partial provider line', async () => {
    const f = fixture()
    const lines: string[] = []
    f.output.on('data', (chunk) => lines.push(chunk.toString()))
    f.provider.write('{"id":1,"result":{"text":"part')
    expect(lines).toEqual([])
    await f.writer.write(
      `${JSON.stringify({ id: `${TASK_MODEL_RPC_ID_PREFIX}synthetic`, method: 'hive/model/start', params: {} })}\n`
    )
    f.provider.end('ial\\ntext"}}\n')
    await f.completed
    expect(lines).toHaveLength(2)
    expect(lines.map((line) => JSON.parse(line).id)).toEqual([
      `${TASK_MODEL_RPC_ID_PREFIX}synthetic`,
      1
    ])
    expect(lines.every((line) => line.split('\n').length === 2)).toBe(true)
    expect(JSON.parse(lines[1]!).result.text).toBe('partial\ntext')
    expect(f.onFailure).not.toHaveBeenCalled()
  })

  it('bounds shared queued producers and rejects all waiters on overflow', async () => {
    const f = fixture()
    const pending = [1, 2, 3].map((id) => f.writer.write(`${JSON.stringify({ id, result: {} })}\n`))
    const all = Promise.allSettled(pending)
    await expect(f.writer.write('{"id":4}\n')).rejects.toThrow('TASK_DOCKER_TRANSPORT_FAILED')
    expect((await all).map((result) => result.status)).toEqual(['rejected', 'rejected', 'rejected'])
    expect(f.onFailure).toHaveBeenCalledTimes(1)
    expect(f.output.readableLength).toBeLessThan(64)
  })

  it('times out a stalled output without an infinite drain waiter', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const rejected = expect(f.writer.write('{"id":1}\n')).rejects.toThrow(
      'TASK_DOCKER_TRANSPORT_FAILED'
    )
    await vi.advanceTimersByTimeAsync(TASK_MODEL_IDLE_TIMEOUT_MS)
    await rejected
    expect(f.onFailure).toHaveBeenCalledTimes(1)
  })

  it.each([
    'invalid\n',
    '[]\n',
    '{"id":"hive-model-forged","result":{}}\n',
    '{"method":"hive/model/start"}\n'
  ])('fails invalid or forged provider output %s', async (line) => {
    const f = fixture()
    f.provider.write(line)
    await f.completed
    expect(f.output.readableLength).toBe(0)
    expect(f.onFailure).toHaveBeenCalledTimes(1)
    expect(f.provider.isPaused()).toBe(true)
  })

  it('fails an incomplete provider line at EOF', async () => {
    const f = fixture()
    f.provider.end('{"id":1')
    await f.completed
    expect(f.onFailure).toHaveBeenCalledTimes(1)
  })

  it('settles completion and fails transport when provider stdout closes without EOF', async () => {
    const f = fixture()
    f.provider.destroy()
    await new Promise((resolve) => setImmediate(resolve))
    expect(f.onFailure).toHaveBeenCalledTimes(1)
    await f.completed
  })

  it('terminates a bounded unterminated provider stdout flood before any shared write', async () => {
    const f = fixture()
    f.provider.write('x'.repeat(NDJSON_MAX_LINE_BYTES + 1))
    await f.completed
    expect(f.onFailure).toHaveBeenCalledTimes(1)
    expect(f.output.readableLength).toBe(0)
  })

  it('keeps queued provider records ordered across slow output drain and EOF', async () => {
    const f = fixture()
    f.provider.end('{"id":1,"result":{}}\n{"id":2,"result":{}}\n')
    await new Promise((resolve) => setImmediate(resolve))
    expect(f.provider.isPaused()).toBe(true)
    const frames: number[] = []
    f.output.on('data', (chunk) => frames.push(JSON.parse(chunk.toString()).id))
    await f.completed
    expect(frames).toEqual([1, 2])
    expect(f.onFailure).not.toHaveBeenCalled()
  })
})
