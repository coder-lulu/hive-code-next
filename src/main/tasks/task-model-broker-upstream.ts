import { isAbsolute } from 'node:path'
import { getCodexBackendAuthHeaders } from '../rate-limits/codex-backend-auth'
import { abortTaskModelWait } from './task-model-broker-io'
import { taskFailure } from './task-failure-diagnostic'
import { classifyRefusedTaskContentType } from './task-response-content-type'

const RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'
const FETCH_DECODED_CODINGS = new Set(['gzip', 'x-gzip', 'deflate', 'br'])

function decodedContentEncoding(value: string | null): boolean {
  if (value === null) {
    return true
  }
  if (value.length > 128) {
    return false
  }
  const codings = value
    .toLowerCase()
    .split(',')
    .map((coding) => coding.trim())
  // Fetch retains the coding header after decoding; mixed identity/unknown chains stay raw.
  return (
    codings.length <= 5 &&
    ((codings.length === 1 && codings[0] === 'identity') ||
      codings.every((coding) => FETCH_DECODED_CODINGS.has(coding)))
  )
}

export type TaskModelAuthScope = Readonly<{
  codexHome: string
  providerAccountId: string
  sessionId: string
}>

export function freezeTaskModelAuthScope(scope: TaskModelAuthScope): TaskModelAuthScope {
  if (
    typeof scope.codexHome !== 'string' ||
    !isAbsolute(scope.codexHome) ||
    scope.codexHome.length > 4096 ||
    scope.codexHome.includes('\0') ||
    typeof scope.providerAccountId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,256}$/.test(scope.providerAccountId) ||
    typeof scope.sessionId !== 'string' ||
    !/^[A-Za-z0-9_-]{8,128}$/.test(scope.sessionId)
  ) {
    throw new Error('TASK_MODEL_AUTH_SCOPE_UNAVAILABLE')
  }
  return Object.freeze({ ...scope })
}

function discard(body: ReadableStream<Uint8Array> | null | undefined) {
  try {
    void body?.cancel().catch(() => undefined)
  } catch {
    /* Disposal does not grant another dispatch or server-side consumption proof. */
  }
}

/** Credentials and provider routing come only from the already selected host account. */
export async function openTaskModelUpstream(options: {
  scope: TaskModelAuthScope
  body: string
  requestId: string
  modelSessionId: string
  responsesLite: boolean
  signal: AbortSignal
  assertCurrent: () => void
  readAuth?: typeof getCodexBackendAuthHeaders
  request?: typeof fetch
  onPhase?: (phase: 'auth' | 'fetch' | 'response') => void
}): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  let reply: Response | undefined
  let phase: 'auth' | 'fetch' | 'response' = 'auth'
  options.onPhase?.(phase)
  try {
    options.assertCurrent()
    let auth: Record<string, string> | null
    try {
      auth = await abortTaskModelWait(
        (options.readAuth ?? getCodexBackendAuthHeaders)(
          { codexHomePath: options.scope.codexHome },
          options.signal
        ),
        options.signal
      )
    } catch (error) {
      throw taskFailure(error, 'auth', 'TASK_MODEL_AUTH_UNAVAILABLE')
    }
    options.assertCurrent()
    if (
      !auth ||
      !/^Bearer [A-Za-z0-9_.~+/=-]{1,16384}$/.test(auth.Authorization ?? '') ||
      auth['ChatGPT-Account-Id'] !== options.scope.providerAccountId
    ) {
      throw new Error('TASK_MODEL_AUTH_UNAVAILABLE')
    }
    const headers = new Headers({
      Authorization: auth.Authorization,
      'ChatGPT-Account-Id': options.scope.providerAccountId,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'Accept-Encoding': 'identity',
      version: '0.159.2',
      originator: 'codex_cli_rs',
      'User-Agent': 'codex-cli/0.159.2 (Hive controlled task)',
      'session-id': options.modelSessionId,
      'thread-id': options.modelSessionId,
      'x-client-request-id': options.requestId,
      ...(options.responsesLite ? { 'x-openai-internal-codex-responses-lite': 'true' } : {})
    })
    phase = 'fetch'
    options.onPhase?.(phase)
    const pending = (options.request ?? fetch)(RESPONSES_URL, {
      method: 'POST',
      headers,
      body: options.body,
      redirect: 'error',
      credentials: 'omit',
      signal: options.signal
    })
    void pending.then(
      (response) => {
        if (options.signal.aborted) {
          discard(response.body)
        }
      },
      () => undefined
    )
    reply = await abortTaskModelWait(pending, options.signal)
    phase = 'response'
    options.onPhase?.(phase)
    options.assertCurrent()
    if (reply.redirected || (reply.url && reply.url !== RESPONSES_URL)) {
      throw new Error('TASK_MODEL_UPSTREAM_UNAVAILABLE')
    }
    if (reply.status !== 200) {
      throw taskFailure(
        undefined,
        phase,
        reply.status === 401 || reply.status === 403
          ? 'TASK_MODEL_AUTH_UNAVAILABLE'
          : reply.status === 429
            ? 'TASK_MODEL_LIMIT_UNAVAILABLE'
            : 'TASK_MODEL_UPSTREAM_UNAVAILABLE',
        reply.status
      )
    }
    const declaredContentType = reply.headers.get('content-type')
    const contentType = declaredContentType ?? ''
    if (
      contentType.length > 128 ||
      !/^text\/event-stream(?:[ \t]*;[ \t]*charset[ \t]*=[ \t]*(?:utf-8|"utf-8"))?[ \t]*$/i.test(
        contentType
      )
    ) {
      throw taskFailure(
        undefined,
        phase,
        'TASK_MODEL_STREAM_REFUSED',
        200,
        'content_type',
        classifyRefusedTaskContentType(declaredContentType)
      )
    }
    if (!decodedContentEncoding(reply.headers.get('content-encoding'))) {
      throw taskFailure(undefined, phase, 'TASK_MODEL_STREAM_REFUSED', 200, 'content_encoding')
    }
    if (!reply.body) {
      throw taskFailure(undefined, phase, 'TASK_MODEL_STREAM_REFUSED', 200, 'missing_body')
    }
    return reply.body.getReader()
  } catch (error) {
    discard(reply?.body)
    throw taskFailure(
      error,
      phase,
      'TASK_MODEL_UPSTREAM_UNAVAILABLE',
      phase === 'response' ? reply?.status : undefined
    )
  }
}
