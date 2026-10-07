import { mkdir } from 'node:fs/promises'
import type { Readable, Writable } from 'node:stream'
import { createIncrementalNdjsonFramer } from '../../shared/main-process-ndjson-framer'
import { spawnProcess, type ProcessSpec } from '../../shared/child-process/run-process'
import { createTaskDockerModelHttpBridge } from './task-docker-model-http'
import { createTaskDockerModelRpc, type TaskDockerModelRpc } from './task-docker-model-rpc'
import {
  attachTaskDockerWorkerOutput,
  createTaskDockerWorkerOutput,
  type TaskDockerWorkerOutput
} from './task-docker-worker-output'
import {
  guardTaskDockerCodexFrame,
  taskDockerCodexResponseId,
  TASK_DOCKER_CODEX_HOME,
  TASK_DOCKER_WORKSPACE
} from './task-docker-codex-policy'

export function taskDockerCodexProcessSpec(): ProcessSpec {
  return {
    program: '/opt/codex/bin/codex',
    args: ['app-server', '-c', 'sandbox_mode="workspace-write"', '-c', 'approval_policy="never"'],
    cwd: TASK_DOCKER_WORKSPACE,
    env: {
      PATH: '/usr/local/bin:/usr/bin:/bin',
      HOME: '/home/hive',
      CODEX_HOME: TASK_DOCKER_CODEX_HOME,
      ORCA_BACKGROUND_LAUNCH: '1'
    }
  }
}

export function attachTaskDockerWorkerInput(options: {
  input: Readable
  providerInput: Writable
  output: Pick<TaskDockerWorkerOutput, 'write'>
  modelRpc: Pick<TaskDockerModelRpc, 'handleResponse'>
  isClosed: () => boolean
  onFailure: () => void
  onEnd?: () => void
}): void {
  let providerBlocked = false
  let outputBlocked = false
  let inputEnded = false
  let providerEnded = false
  let failed = false
  const fail = () => {
    if (failed) {
      return
    }
    failed = true
    options.input.pause()
    options.onFailure()
  }
  const paused = () => providerBlocked || outputBlocked || failed || options.isClosed()
  const resumeInput = () => {
    if (options.isClosed() || paused()) {
      return
    }
    try {
      framer.resume()
    } catch {
      fail()
    } finally {
      if (failed || options.isClosed()) {
        framer.reset()
      }
    }
    if (!paused()) {
      if (inputEnded && !providerEnded) {
        providerEnded = true
        options.onEnd?.()
        options.providerInput.end()
      } else if (!inputEnded) {
        options.input.resume()
      }
    }
  }
  const framer = createIncrementalNdjsonFramer(
    (value) => {
      if (options.isClosed()) {
        return
      }
      if (options.modelRpc.handleResponse(value)) {
        return
      }
      let guarded: Record<string, unknown>
      try {
        guarded = guardTaskDockerCodexFrame(value)
      } catch {
        const id = taskDockerCodexResponseId(value)
        if (id !== undefined) {
          outputBlocked = true
          options.input.pause()
          void options.output
            .write(
              `${JSON.stringify({ id, error: { code: -32602, message: 'TASK_DOCKER_POLICY_REFUSED' } })}\n`
            )
            .then(() => {
              outputBlocked = false
              resumeInput()
            })
            .catch(fail)
        }
        return
      }
      if (!options.providerInput.write(`${JSON.stringify(guarded)}\n`)) {
        providerBlocked = true
        options.input.pause()
      }
    },
    fail,
    { maxLineBytes: 16 * 1024 * 1024, shouldPause: paused }
  )
  options.input.setEncoding('utf8').on('data', (chunk: string) => {
    if (failed || options.isClosed()) {
      return
    }
    try {
      framer.feed(chunk)
    } catch {
      fail()
    } finally {
      if (failed || options.isClosed()) {
        framer.reset()
      }
    }
  })
  options.providerInput
    .on('drain', () => {
      providerBlocked = false
      resumeInput()
    })
    .on('error', fail)
  options.input
    .on('end', () => {
      inputEnded = true
      resumeInput()
    })
    .on('error', fail)
}

/** PID 1 belongs to the Docker boundary; host stop must still verify the whole container. */
export async function startTaskDockerWorker(): Promise<void> {
  if (process.platform !== 'linux' || process.getuid?.() !== 1000) {
    throw new Error('TASK_DOCKER_PLATFORM_UNAVAILABLE')
  }
  let closed = false
  let child: ReturnType<typeof spawnProcess> | undefined
  let bridge: Awaited<ReturnType<typeof createTaskDockerModelHttpBridge>> | undefined
  const closeChannels = () => {
    void bridge?.close()
    void modelRpc.close()
  }
  const fatal = () => {
    if (closed) {
      return
    }
    closed = true
    closeChannels()
    output.close()
    process.stderr.write('TASK_DOCKER_TRANSPORT_FAILED\n')
    child?.stdin.destroy()
    child?.kill('SIGTERM')
    process.stdin.destroy()
    process.exitCode = 2
    setTimeout(() => process.exit(2), 250).unref()
  }
  const output = createTaskDockerWorkerOutput({ output: process.stdout, onFailure: fatal })
  const modelRpc = createTaskDockerModelRpc({ write: output.write, onFailure: fatal })
  try {
    await mkdir(TASK_DOCKER_CODEX_HOME, { recursive: true, mode: 0o700 })
    bridge = await createTaskDockerModelHttpBridge({ request: modelRpc.request, onFailure: fatal })
    if (closed) {
      throw new Error('TASK_DOCKER_TRANSPORT_FAILED')
    }
    child = spawnProcess(taskDockerCodexProcessSpec())
  } catch {
    closed = true
    closeChannels()
    output.close()
    throw new Error('TASK_DOCKER_TRANSPORT_FAILED')
  }
  attachTaskDockerWorkerInput({
    input: process.stdin,
    providerInput: child.stdin,
    output,
    modelRpc,
    isClosed: () => closed,
    onFailure: fatal,
    onEnd: closeChannels
  })
  const { completed } = attachTaskDockerWorkerOutput({
    providerOutput: child.stdout,
    write: output.write,
    isClosed: () => closed,
    onFailure: fatal
  })
  child.stderr.on('error', fatal).resume()
  child.on('error', fatal).on('close', (code) => {
    closeChannels()
    process.stdin.destroy()
    void completed.then(() => {
      if (closed) {
        return
      }
      closed = true
      output.close()
      process.exitCode = code ?? 2
    })
  })
}
