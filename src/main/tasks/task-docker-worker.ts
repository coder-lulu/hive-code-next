import { mkdir } from 'node:fs/promises'
import type { Readable, Writable } from 'node:stream'
import { createIncrementalNdjsonFramer } from '../../shared/main-process-ndjson-framer'
import { spawnProcess, type ProcessSpec } from '../../shared/child-process/run-process'
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
  output: Writable
  isClosed: () => boolean
  onFailure: () => void
}): void {
  let providerBlocked = false
  let outputBlocked = false
  let inputEnded = false
  let providerEnded = false
  const paused = () => providerBlocked || outputBlocked
  const resumeInput = () => {
    if (options.isClosed() || paused()) {
      return
    }
    framer.resume()
    if (!paused()) {
      if (inputEnded && !providerEnded) {
        providerEnded = true
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
      let guarded: Record<string, unknown>
      try {
        guarded = guardTaskDockerCodexFrame(value)
      } catch {
        const id = taskDockerCodexResponseId(value)
        if (
          id !== undefined &&
          !options.output.write(
            `${JSON.stringify({ id, error: { code: -32602, message: 'TASK_DOCKER_POLICY_REFUSED' } })}\n`
          )
        ) {
          outputBlocked = true
          options.input.pause()
        }
        return
      }
      if (!options.providerInput.write(`${JSON.stringify(guarded)}\n`)) {
        providerBlocked = true
        options.input.pause()
      }
    },
    options.onFailure,
    { maxLineBytes: 16 * 1024 * 1024, shouldPause: paused }
  )
  options.input.setEncoding('utf8').on('data', (chunk: string) => {
    try {
      framer.feed(chunk)
    } catch {
      options.onFailure()
    }
  })
  options.providerInput
    .on('drain', () => {
      providerBlocked = false
      resumeInput()
    })
    .on('error', options.onFailure)
  options.output
    .on('drain', () => {
      outputBlocked = false
      resumeInput()
    })
    .on('error', options.onFailure)
  options.input
    .on('end', () => {
      inputEnded = true
      resumeInput()
    })
    .on('error', options.onFailure)
}

/** PID 1 belongs to the Docker boundary; host stop must still verify the whole container. */
export async function startTaskDockerWorker(): Promise<void> {
  if (process.platform !== 'linux' || process.getuid?.() !== 1000) {
    throw new Error('TASK_DOCKER_PLATFORM_UNAVAILABLE')
  }
  await mkdir(TASK_DOCKER_CODEX_HOME, { recursive: true, mode: 0o700 })
  const child = spawnProcess(taskDockerCodexProcessSpec())
  let closed = false
  const fatal = () => {
    if (closed) {
      return
    }
    closed = true
    process.stderr.write('TASK_DOCKER_TRANSPORT_FAILED\n')
    child.stdin.destroy()
    child.kill('SIGTERM')
    process.exitCode = 2
    setTimeout(() => process.exit(2), 250).unref()
  }
  attachTaskDockerWorkerInput({
    input: process.stdin,
    providerInput: child.stdin,
    output: process.stdout,
    isClosed: () => closed,
    onFailure: fatal
  })
  child.stdout.pipe(process.stdout)
  child.stderr.pipe(process.stderr)
  child.on('error', fatal).on('close', (code) => {
    closed = true
    process.stdin.destroy()
    process.exitCode = code ?? 2
  })
}
