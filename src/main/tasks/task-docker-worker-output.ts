import type { Readable, Writable } from 'node:stream'
import {
  createCodexAppServerRecordReader,
  type CodexAppServerRecordReader
} from '../codex/codex-app-server-record-reader'
import { NDJSON_MAX_LINE_BYTES } from '../../shared/main-process-ndjson-framer'
import { TASK_MODEL_IDLE_TIMEOUT_MS, TASK_MODEL_RPC_ID_PREFIX } from './task-model-channel-protocol'

const MAX_PENDING = 3
const failure = () => new Error('TASK_DOCKER_TRANSPORT_FAILED')

export function createTaskDockerWorkerOutput(options: { output: Writable; onFailure: () => void }) {
  const queue: { line: string; resolve: () => void; reject: (error: Error) => void }[] = []
  let blocked = false
  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const finish = (failed: boolean) => {
    if (closed) {
      return
    }
    closed = true
    clearTimeout(timer)
    for (const entry of queue.splice(0)) {
      entry.reject(failure())
    }
    options.output.off('drain', drain)
    if (failed) {
      options.onFailure()
    }
  }
  const pump = () => {
    while (!closed && !blocked && queue.length) {
      try {
        if (!options.output.write(queue[0]!.line)) {
          blocked = true
          timer = setTimeout(() => finish(true), TASK_MODEL_IDLE_TIMEOUT_MS)
          timer.unref()
          return
        }
        queue.shift()!.resolve()
      } catch {
        finish(true)
      }
    }
  }
  const drain = () => {
    if (!blocked || closed) {
      return
    }
    blocked = false
    clearTimeout(timer)
    queue.shift()!.resolve()
    pump()
  }
  options.output
    .on('drain', drain)
    .on('error', () => finish(true))
    .on('close', () => finish(true))
  return {
    write(line: string): Promise<void> {
      if (closed) {
        return Promise.reject(failure())
      }
      if (
        !line.endsWith('\n') ||
        line.slice(0, -1).includes('\n') ||
        Buffer.byteLength(line) - 1 > NDJSON_MAX_LINE_BYTES ||
        queue.length >= MAX_PENDING
      ) {
        finish(true)
        return Promise.reject(failure())
      }
      return new Promise<void>((resolve, reject) => {
        queue.push({ line, resolve, reject })
        pump()
      })
    },
    close: () => finish(false)
  }
}

export type TaskDockerWorkerOutput = ReturnType<typeof createTaskDockerWorkerOutput>

export function attachTaskDockerWorkerOutput(options: {
  providerOutput: Readable
  write: (line: string) => Promise<void>
  isClosed: () => boolean
  onFailure: () => void
}): { completed: Promise<void> } {
  let failed = false
  let partial = false
  let ended = false
  let writing = false
  let resolveCompleted!: () => void
  const completed = new Promise<void>((resolve) => {
    resolveCompleted = resolve
  })
  const fail = () => {
    if (failed) {
      return
    }
    failed = true
    options.providerOutput.pause()
    resolveCompleted()
    options.onFailure()
  }
  options.providerOutput.on('data', (chunk: string) => {
    if (chunk.length) {
      partial = !chunk.endsWith('\n')
    }
  })
  const reader: CodexAppServerRecordReader = createCodexAppServerRecordReader({
    stdout: options.providerOutput,
    maxLineBytes: NDJSON_MAX_LINE_BYTES,
    onRecord: (value) => {
      if (failed || options.isClosed()) {
        return
      }
      if (
        typeof value !== 'object' ||
        value === null ||
        Array.isArray(value) ||
        ('id' in value &&
          typeof value.id === 'string' &&
          value.id.startsWith(TASK_MODEL_RPC_ID_PREFIX)) ||
        ('method' in value &&
          typeof value.method === 'string' &&
          value.method.startsWith('hive/model/'))
      ) {
        throw failure()
      }
      reader.pause()
      writing = true
      void options
        .write(`${JSON.stringify(value)}\n`)
        .then(() => {
          writing = false
          if (!failed && !options.isClosed()) {
            reader.resume()
          }
          if (ended && !writing) {
            resolveCompleted()
          }
        })
        .catch(fail)
    },
    onRejected: () => {
      throw failure()
    },
    onFatal: fail
  })
  options.providerOutput.on('error', fail).on('end', () => {
    ended = true
    if (partial) {
      fail()
    } else if (!writing) {
      resolveCompleted()
    }
  })
  options.providerOutput.on('close', () => {
    if (!ended && !failed) {
      if (options.isClosed()) {
        resolveCompleted()
      } else {
        fail()
      }
    }
  })
  return { completed }
}
