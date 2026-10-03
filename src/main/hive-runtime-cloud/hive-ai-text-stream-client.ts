import { getMainHttpClient } from '../network/http-client'
import { requireHiveAiCloudOrigin } from './hive-ai-catalog-client'
import type { HiveRuntimeCloudFetch } from './hive-runtime-cloud-http-client'
import { createHiveAiTextProof, HIVE_AI_TEXT_INFERENCE_PATH } from './hive-ai-runtime-proof'
import { parseHiveAiTextGrantRequest } from '../../shared/hive-ai-text-grant-request'
import { hiveAiSignedTextGrantSchema } from '../../shared/hive-ai-text-grant'
import { hiveAiRuntimeOwnerSchema } from '../../shared/hive-ai-text-control'
import type { HiveRuntimeCloudIdentity } from './hive-runtime-cloud-identity-store'
import { readHiveAiTextStream } from './hive-ai-text-stream'

/** Main-only one-shot transport. Ambiguous outcomes must be resolved by status, never retried. */
export class HiveAiTextStreamClient {
  private readonly origin: string
  constructor(
    origin: string,
    private readonly fetchImpl: HiveRuntimeCloudFetch = (url, init) =>
      getMainHttpClient().fetch(url, init)
  ) {
    this.origin = requireHiveAiCloudOrigin(origin)
  }
  async execute(input: {
    command: unknown
    grant: unknown
    owner: unknown
    identity: HiveRuntimeCloudIdentity
    authorityId: string
    accessToken: string
    signal: AbortSignal
    assertCurrent: () => void
    onText: (text: string) => void | Promise<void>
  }) {
    const { signal, assertCurrent, onText, accessToken, authorityId } = input
    const controller = new AbortController()
    const abort = () => controller.abort()
    const guard = () => {
      assertCurrent()
      if (signal.aborted || controller.signal.aborted) {
        throw new Error('unavailable')
      }
    }
    signal.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(abort, 120000)
    const authorization = setInterval(() => {
      try {
        guard()
      } catch {
        abort()
      }
    }, 1000)
    let idle = setTimeout(abort, 15000)
    let readerBody: ReadableStream<Uint8Array> | null = null
    try {
      guard()
      if (!accessToken || accessToken.length > 8192 || /\s/.test(accessToken)) {
        throw new Error('invalid identity')
      }
      const command = parseHiveAiTextGrantRequest(input.command)
      const owner = hiveAiRuntimeOwnerSchema.parse(input.owner)
      const grant = hiveAiSignedTextGrantSchema.parse(input.grant)
      const proof = createHiveAiTextProof({
        command,
        owner,
        identity: { ...input.identity },
        authorityId,
        operation: 'inference'
      })
      const grantHeader = Buffer.from(JSON.stringify(grant), 'utf8').toString('base64url')
      if (grantHeader.length > 8192) {
        throw new Error('invalid grant')
      }
      guard()
      const pending = this.fetchImpl(`${this.origin}${HIVE_AI_TEXT_INFERENCE_PATH}`, {
        method: 'POST',
        cache: 'no-store',
        redirect: 'error',
        credentials: 'omit',
        signal: controller.signal,
        headers: {
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'X-Hive-AI-Proof': proof.header,
          'X-Hive-AI-Grant': grantHeader
        },
        body: proof.body
      }).then((response) => {
        if (controller.signal.aborted) {
          void response.body?.cancel().catch(() => undefined)
          throw new Error('unavailable')
        }
        return response
      })
      let stopWaiting = () => {}
      const cancelled = new Promise<never>((_, reject) => {
        stopWaiting = () => reject(new Error('unavailable'))
        controller.signal.addEventListener('abort', stopWaiting, { once: true })
        if (controller.signal.aborted) {
          stopWaiting()
        }
      })
      let response: Response
      try {
        response = await Promise.race([pending, cancelled])
      } finally {
        controller.signal.removeEventListener('abort', stopWaiting)
      }
      readerBody = response.body
      guard()
      if (
        response.status !== 200 ||
        response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
          'text/event-stream' ||
        !readerBody
      ) {
        throw new Error('invalid stream')
      }
      clearTimeout(idle)
      idle = setTimeout(abort, 60000)
      return await readHiveAiTextStream({
        body: readerBody,
        requestId: command.request.requestId,
        signal: controller.signal,
        assertCurrent: guard,
        onText: (text) => {
          clearTimeout(idle)
          idle = setTimeout(abort, 60000)
          return onText(text)
        }
      })
    } catch {
      throw new Error('hive_ai_stream_unavailable')
    } finally {
      clearTimeout(timeout)
      clearInterval(authorization)
      clearTimeout(idle)
      signal.removeEventListener('abort', abort)
      controller.abort()
      if (readerBody && !readerBody.locked) {
        void readerBody.cancel().catch(() => undefined)
      }
    }
  }
}
