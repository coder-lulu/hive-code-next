import type { IncomingMessage } from 'node:http'
import { TASK_MODEL_LOOPBACK_HOST, TASK_MODEL_REQUEST_BYTES } from './task-model-channel-protocol'

export const TASK_MODEL_HEADER_BYTES = 16 * 1024
const metadata = new Set([
  'originator',
  'version',
  'session-id',
  'thread-id',
  'x-client-request-id',
  'x-codex-window-id',
  'x-codex-turn-metadata',
  'x-codex-beta-features',
  'x-openai-internal-codex-responses-lite'
])
const ordinary = new Set([
  'host',
  'content-type',
  'content-length',
  'transfer-encoding',
  'accept',
  'accept-encoding',
  'user-agent',
  'connection'
])

export class HttpFailure extends Error {
  constructor(readonly status = 503) {
    super('TASK_MODEL_REQUEST_FAILED')
  }
}

export function validateTaskDockerModelHeaders(request: IncomingMessage, port: number): void {
  const seen = new Set<string>()
  let bytes = 0
  if (request.rawHeaders.length > 64) {
    throw new HttpFailure(431)
  }
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index]!.toLowerCase()
    const value = request.rawHeaders[index + 1]!
    bytes += Buffer.byteLength(name) + Buffer.byteLength(value) + 4
    const limit = metadata.has(name)
      ? ['x-codex-turn-metadata', 'x-codex-beta-features'].includes(name)
        ? 4096
        : 160
      : 4096
    if (
      bytes > TASK_MODEL_HEADER_BYTES ||
      seen.has(name) ||
      (!ordinary.has(name) && !metadata.has(name)) ||
      value.length > limit ||
      !/^[\x20-\x7e]*$/.test(value) ||
      (name === 'version' && value !== '0.159.2') ||
      (name === 'connection' && !/^(close|keep-alive)$/i.test(value)) ||
      (name === 'x-openai-internal-codex-responses-lite' && value !== 'true')
    ) {
      throw new HttpFailure(400)
    }
    seen.add(name)
  }
  if (
    request.headers.host !== `${TASK_MODEL_LOOPBACK_HOST}:${port}` ||
    !/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '') ||
    (request.headers['transfer-encoding'] !== undefined &&
      request.headers['transfer-encoding'] !== 'chunked')
  ) {
    throw new HttpFailure(400)
  }
  const length = request.headers['content-length']
  if (
    length !== undefined &&
    (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > TASK_MODEL_REQUEST_BYTES)
  ) {
    throw new HttpFailure(413)
  }
}

export function readTaskDockerModelBody(
  request: IncomingMessage,
  touch: () => void
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, rejectBody) => {
    const chunks: Buffer[] = []
    let bytes = 0
    const clean = () => {
      request.off('data', data).off('end', end).off('aborted', error).off('error', error)
    }
    const error = () => {
      clean()
      rejectBody(new HttpFailure(400))
    }
    const end = () => {
      clean()
      if (Object.keys(request.trailers).length) {
        rejectBody(new HttpFailure(400))
      } else {
        resolve(Buffer.concat(chunks, bytes))
      }
    }
    const data = (chunk: Buffer) => {
      touch()
      bytes += chunk.length
      if (bytes > TASK_MODEL_REQUEST_BYTES) {
        request.pause()
        clean()
        rejectBody(new HttpFailure(413))
      } else {
        chunks.push(chunk)
      }
    }
    request.on('data', data).once('end', end).once('aborted', error).once('error', error)
  })
}
