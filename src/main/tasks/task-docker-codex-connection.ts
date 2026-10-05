import { spawnProcess } from '../../shared/child-process/run-process'
import { RetryableProcessExitProof } from '../../shared/child-process/retryable-process-exit-proof'
import { NDJSON_MAX_LINE_BYTES } from '../../shared/main-process-ndjson-framer'
import {
  openCodexAppServerConnection,
  type CodexAppServerConnection,
  type CodexAppServerConnectionHandlers
} from '../codex/codex-app-server-connection'
import {
  CodexAppServerHandshakeExitUnprovenError,
  isCodexAppServerHandshakeExitUnprovenError
} from '../codex/codex-app-server-handshake-exit-proof'
import { guardTaskDockerCodexFrame, taskDockerCodexFrameParams } from './task-docker-codex-policy'
import type { createTaskDockerBoundary } from './task-docker-boundary'

const admittedBoundaries = new WeakSet<ReturnType<typeof createTaskDockerBoundary>>()

/** The existing stdio connection is a transport; only the Docker host proves all writers stopped. */
export async function openTaskDockerCodexConnection(options: {
  boundary: ReturnType<typeof createTaskDockerBoundary>
  handlers?: CodexAppServerConnectionHandlers
  open?: typeof openCodexAppServerConnection
}): Promise<CodexAppServerConnection> {
  if (admittedBoundaries.has(options.boundary)) {
    throw new Error('TASK_DOCKER_ATTACH_ALREADY_ADMITTED')
  }
  admittedBoundaries.add(options.boundary)
  const prepared = await options.boundary.prepare()
  prepared.assertCurrent()
  const handlers = options.handlers ?? {}
  const exitProof = new RetryableProcessExitProof()
  let raw: CodexAppServerConnection | undefined
  let pid: number | undefined
  let closing = false
  let exitReported = false
  const stopBoundary = async () => {
    try {
      return await options.boundary.stop()
    } catch {
      return false
    }
  }
  const close = () =>
    exitProof.run(async () => {
      closing = true
      const stopped = await stopBoundary()
      let transportExited = raw === undefined
      try {
        transportExited = (await raw?.close()) ?? true
      } catch {
        /* No transport exit proof. */
      }
      return stopped && transportExited
    })
  const retained: CodexAppServerConnection = {
    get pid() {
      return pid
    },
    get closed() {
      return closing || raw?.closed !== false
    },
    request: async (method, params, requestOptions) => {
      prepared.assertCurrent()
      const guarded = guardTaskDockerCodexFrame({ method, ...(params ? { params } : {}) })
      if (!raw || closing) {
        throw new Error('TASK_DOCKER_TRANSPORT_UNAVAILABLE')
      }
      return raw.request(method, taskDockerCodexFrameParams(guarded), requestOptions)
    },
    notify: (method, params) => {
      prepared.assertCurrent()
      const guarded = guardTaskDockerCodexFrame({ method, ...(params ? { params } : {}) })
      if (!closing) {
        raw?.notify(method, taskDockerCodexFrameParams(guarded))
      }
    },
    respond: (id, result) => {
      prepared.assertCurrent()
      if (!closing) {
        raw?.respond(id, result)
      }
    },
    respondWithError: (id, code, message) => {
      prepared.assertCurrent()
      if (!closing) {
        raw?.respondWithError(id, code, message)
      }
    },
    pauseReading: () => raw?.pauseReading?.(),
    resumeReading: () => raw?.resumeReading?.(),
    close
  }
  try {
    raw = await (options.open ?? openCodexAppServerConnection)(
      { ...prepared.launch, maxFrameBytes: NDJSON_MAX_LINE_BYTES },
      {
        ...handlers,
        onSpawned: async (observedPid) => {
          pid = observedPid
          prepared.assertCurrent()
          await handlers.onSpawned?.(observedPid)
          prepared.assertCurrent()
        },
        onExit: (error) => {
          void stopBoundary()
            .then((stopped) => {
              if (stopped && !closing && !exitReported) {
                exitReported = true
                handlers.onExit?.(error)
              }
            })
            .catch(() => undefined)
        }
      },
      (spec) => {
        prepared.assertCurrent()
        return spawnProcess(spec)
      }
    )
    prepared.assertCurrent()
    return retained
  } catch (error) {
    if (isCodexAppServerHandshakeExitUnprovenError(error)) {
      raw = error.connection
    }
    if (!(await close())) {
      throw new CodexAppServerHandshakeExitUnprovenError(retained, error)
    }
    throw error
  }
}
