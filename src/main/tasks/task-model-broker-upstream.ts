import { isAbsolute } from 'node:path'
import { getCodexBackendAuthHeaders } from '../rate-limits/codex-backend-auth'
import { abortTaskModelWait } from './task-model-broker-io'

const RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'

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
}): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  let reply: Response | undefined
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
    } catch {
      throw new Error('TASK_MODEL_AUTH_UNAVAILABLE')
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
    options.assertCurrent()
    if (reply.redirected || (reply.url && reply.url !== RESPONSES_URL)) {
      throw new Error('TASK_MODEL_UPSTREAM_UNAVAILABLE')
    }
    if (reply.status !== 200) {
      throw new Error(
        reply.status === 401 || reply.status === 403
          ? 'TASK_MODEL_AUTH_UNAVAILABLE'
          : reply.status === 429
            ? 'TASK_MODEL_LIMIT_UNAVAILABLE'
            : 'TASK_MODEL_UPSTREAM_UNAVAILABLE'
      )
    }
    if (
      !/^text\/event-stream(?:\s*;\s*charset=utf-8)?$/i.test(
        reply.headers.get('content-type') ?? ''
      ) ||
      (reply.headers.has('content-encoding') &&
        reply.headers.get('content-encoding') !== 'identity') ||
      !reply.body
    ) {
      throw new Error('TASK_MODEL_STREAM_REFUSED')
    }
    return reply.body.getReader()
  } catch (error) {
    discard(reply?.body)
    throw new Error(
      error instanceof Error && /^TASK_MODEL_[A-Z_]+$/.test(error.message)
        ? error.message
        : 'TASK_MODEL_UPSTREAM_UNAVAILABLE'
    )
  }
}
