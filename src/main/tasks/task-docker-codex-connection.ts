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
import { createTaskDockerModelChannelPort, isTaskDockerModelId } from './task-docker-model-channel'
import type { TaskModelChannel } from './task-model-channel-protocol'
import type { TaskExecutionDispatchAuthorization } from './task-execution-ports'
import { prepareTaskDispatch } from './task-dispatch-authorization'
import { assertTaskAuthorizationCurrent } from './task-structured-launch-origin'
import type { TaskFailureError } from './task-failure-diagnostic'

type ConnectionBoundary = Pick<
  ReturnType<typeof createTaskDockerBoundary>,
  'prepare' | 'inspect' | 'stop'
>
const admittedBoundaries = new WeakSet<ConnectionBoundary>()

/** The existing stdio connection is a transport; only the Docker host proves all writers stopped. */
export async function openTaskDockerCodexConnection(options: {
  boundary: ConnectionBoundary
  handlers?: CodexAppServerConnectionHandlers
  open?: typeof openCodexAppServerConnection
  modelChannel?: TaskModelChannel
  dispatch?: TaskExecutionDispatchAuthorization
}): Promise<CodexAppServerConnection> {
  if (admittedBoundaries.has(options.boundary)) {
    throw new Error('TASK_DOCKER_ATTACH_ALREADY_ADMITTED')
  }
  admittedBoundaries.add(options.boundary)
  let prepared: Awaited<ReturnType<typeof options.boundary.prepare>>
  try {
    prepared = await options.boundary.prepare()
    prepared.assertCurrent()
  } catch (error) {
    await options.modelChannel?.close().catch(() => undefined)
    throw error
  }
  const handlers = options.handlers ?? {}
  const dispatch = options.dispatch
  const exitProof = new RetryableProcessExitProof()
  let raw: CodexAppServerConnection | undefined
  let pid: number | undefined
  let closing = false
  let exitReported = false
  let modelFailed = false
  let modelFailure: TaskFailureError | undefined
  const assertUsable = () => {
    prepared.assertCurrent()
    if (closing || modelFailed) {
      throw new Error('TASK_DOCKER_TRANSPORT_UNAVAILABLE')
    }
  }
  const modelPort = createTaskDockerModelChannelPort({
    channel: options.modelChannel,
    connection: () => raw,
    assertCurrent: assertUsable,
    onFailure: (failure) => {
      modelFailure ??= failure
      modelFailed = true
      queueMicrotask(() => {
        void close().catch(() => undefined)
      })
    }
  })
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
      const modelClosing = modelPort.close()
      const stopped = await stopBoundary()
      const modelClosed = await modelClosing
      let transportExited = raw === undefined
      try {
        transportExited = (await raw?.close()) ?? true
      } catch {
        /* No transport exit proof. */
      }
      const proven = modelClosed && stopped && transportExited
      if (proven && modelFailed && !exitReported) {
        exitReported = true
        handlers.onExit?.(modelFailure ?? new Error('TASK_MODEL_CHANNEL_UNAVAILABLE'))
      }
      return proven
    })
  const retained: CodexAppServerConnection = {
    get pid() {
      return pid
    },
    get closed() {
      return closing || modelFailed || raw?.closed !== false
    },
    request: async (method, params, requestOptions) => {
      assertUsable()
      const guarded = guardTaskDockerCodexFrame({ method, ...(params ? { params } : {}) })
      if (!raw) {
        throw new Error('TASK_DOCKER_TRANSPORT_UNAVAILABLE')
      }
      return raw.request(method, taskDockerCodexFrameParams(guarded), requestOptions)
    },
    notify: (method, params) => {
      assertUsable()
      const guarded = guardTaskDockerCodexFrame({ method, ...(params ? { params } : {}) })
      raw?.notify(method, taskDockerCodexFrameParams(guarded))
    },
    respond: (id, result) => {
      assertUsable()
      if (isTaskDockerModelId(id)) {
        throw new Error('TASK_DOCKER_POLICY_REFUSED')
      }
      raw?.respond(id, result)
    },
    respondWithError: (id, code, message) => {
      assertUsable()
      if (isTaskDockerModelId(id)) {
        throw new Error('TASK_DOCKER_POLICY_REFUSED')
      }
      raw?.respondWithError(id, code, message)
    },
    pauseReading: () => raw?.pauseReading?.(),
    resumeReading: () => raw?.resumeReading?.(),
    close
  }
  try {
    assertUsable()
    if (dispatch) {
      await prepareTaskDispatch(dispatch, assertUsable)
    }
    raw = await (options.open ?? openCodexAppServerConnection)(
      { ...prepared.launch, maxFrameBytes: NDJSON_MAX_LINE_BYTES },
      {
        ...handlers,
        onServerRequest: (request) => {
          if (!modelPort.handle(request)) {
            handlers.onServerRequest?.(request)
          }
        },
        onNotification: (method, params) => {
          if (!modelPort.notification(method)) {
            handlers.onNotification?.(method, params)
          }
        },
        onUnhandledFrame: (kind, payload) => {
          if (!modelPort.unhandled(payload)) {
            handlers.onUnhandledFrame?.(kind, payload)
          }
        },
        onSpawned: async (observedPid) => {
          pid = observedPid
          assertUsable()
          await handlers.onSpawned?.(observedPid)
          assertUsable()
        },
        onExit: (error) => {
          const modelClosing = modelPort.close()
          void stopBoundary()
            .then(async (stopped) => {
              if (stopped && (await modelClosing) && !closing && !exitReported) {
                exitReported = true
                handlers.onExit?.(modelFailure ?? error)
              }
            })
            .catch(() => undefined)
        }
      },
      (spec) => {
        assertUsable()
        if (dispatch) {
          assertTaskAuthorizationCurrent(() => dispatch.assertCurrent())
        }
        return spawnProcess(spec)
      }
    )
    assertUsable()
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
