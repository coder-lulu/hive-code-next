import { request as httpRequest } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startLocalTaskTransport, TASK_TRANSPORT_MAX_BYTES } from './local-task-transport'
import { TaskExecutionError } from './task-execution-error'
import { taskCommand, TASK_TEST_CALLER, TASK_TEST_NOW } from './task-execution.test-fixture'
import { taskExecutionIdentity } from './task-execution-record'
import { computeTaskExecutionFingerprint } from '../../shared/task-execution/task-execution-fingerprint'
import { TaskExecutionAcceptedSchema } from '../../shared/task-execution/task-execution-receipts'
import { TaskExecutionObservationSchema } from '../../shared/task-execution/task-execution-observation'

let transport: Awaited<ReturnType<typeof startLocalTaskTransport>> | undefined
afterEach(async () => {
  await transport?.close()
  transport = undefined
})

async function fixture() {
  const command = taskCommand()
  const accepted = TaskExecutionAcceptedSchema.parse({
    ...taskExecutionIdentity(command),
    commandFingerprint: computeTaskExecutionFingerprint(
      command,
      TASK_TEST_CALLER.operationCallerKey
    ),
    recordedAt: new Date(TASK_TEST_NOW).toISOString(),
    kind: 'execution.accepted',
    receiptId: 'receipt:test',
    status: 'accepted',
    operationId: command.operationId,
    workspaceExecutionClaimRef: command.workspaceExecutionClaimRef,
    writeFence: command.writeFence
  })
  const observation = TaskExecutionObservationSchema.parse({
    ...taskExecutionIdentity(command),
    kind: 'execution.observation',
    commandFingerprint: accepted.commandFingerprint,
    status: 'accepted',
    accepted,
    events: [],
    cursor: 0,
    lastSequence: 1,
    sessionRef: null,
    result: null
  })
  const host = {
    start: vi.fn(async () => accepted),
    observe: vi.fn(async () => observation),
    reconcile: vi.fn(async () => observation),
    cancel: vi.fn(async () => observation)
  }
  transport = await startLocalTaskTransport({
    host,
    authenticate: (token) =>
      token === 'test-service-credential' ? { operationCallerKey: 'service:test' } : null,
    capabilities: () => ({ kind: 'execution.capabilities' })
  })
  return { host, baseUrl: transport.baseUrl }
}
const headers = {
  'Content-Type': 'application/json',
  Authorization: 'Bearer test-service-credential'
}

describe('authenticated, bounded local task transport', () => {
  it('authenticates before dispatch and exposes acceptance without completion', async () => {
    const { host, baseUrl } = await fixture()
    const response = await fetch(`${baseUrl}/execution/start`, {
      method: 'POST',
      headers,
      body: '{}'
    })
    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({ kind: 'execution.accepted', status: 'accepted' })
    expect(host.start).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ operationCallerKey: 'service:test' })
    )
  })
  it('rejects an unauthenticated loopback request before parsing or dispatching', async () => {
    const { host, baseUrl } = await fixture()
    const response = await fetch(`${baseUrl}/execution/start`, {
      method: 'POST',
      body: 'invalid-json'
    })
    expect(response.status).toBe(401)
    expect(host.start).not.toHaveBeenCalled()
  })
  it('rejects browser-origin requests even with a service credential', async () => {
    const { host, baseUrl } = await fixture()
    const response = await fetch(`${baseUrl}/execution/start`, {
      method: 'POST',
      headers: { ...headers, Origin: 'https://example.invalid' },
      body: '{}'
    })
    expect(response.status).toBe(403)
    expect(host.start).not.toHaveBeenCalled()
  })
  it('rejects declared oversized bodies before host effects', async () => {
    const { host, baseUrl } = await fixture()
    const response = await fetch(`${baseUrl}/execution/start`, {
      method: 'POST',
      headers,
      body: ' '.repeat(TASK_TRANSPORT_MAX_BYTES + 1)
    })
    expect(response.status).toBe(413)
    expect(host.start).not.toHaveBeenCalled()
  })
  it('bounds a chunked body without relying on Content-Length', async () => {
    const { host, baseUrl } = await fixture()
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        `${baseUrl}/execution/start`,
        { method: 'POST', headers },
        (response) => {
          response.resume()
          response.on('end', () => resolve(response.statusCode!))
        }
      )
      request.on('error', reject)
      request.write(' '.repeat(TASK_TRANSPORT_MAX_BYTES))
      request.end('x')
    })
    expect(status).toBe(413)
    expect(host.start).not.toHaveBeenCalled()
  })
  it('rejects malformed JSON and invalid UTF-8 instead of normalizing the command', async () => {
    const { host, baseUrl } = await fixture()
    for (const body of [
      'broken-json',
      Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d])
    ]) {
      const response = await fetch(`${baseUrl}/execution/start`, { method: 'POST', headers, body })
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: { code: 'INVALID_REQUEST' } })
    }
    expect(host.start).not.toHaveBeenCalled()
  })
  it('maps a refusal without leaking exception text or credentials', async () => {
    const { host, baseUrl } = await fixture()
    host.start.mockRejectedValueOnce(new TaskExecutionError('IDEMPOTENCY_CONFLICT'))
    const response = await fetch(`${baseUrl}/execution/start`, {
      method: 'POST',
      headers,
      body: '{}'
    })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: { code: 'IDEMPOTENCY_CONFLICT' } })
    host.start.mockRejectedValueOnce(new Error('private prompt secret'))
    const failure = await fetch(`${baseUrl}/execution/start`, {
      method: 'POST',
      headers,
      body: '{}'
    })
    expect(await failure.text()).not.toContain('private prompt secret')
  })
  it('fails a capability request explicitly when the authorized host is unavailable', async () => {
    transport = await startLocalTaskTransport({
      host: { start: vi.fn(), observe: vi.fn(), cancel: vi.fn(), reconcile: vi.fn() },
      authenticate: () => ({ operationCallerKey: 'service:test' }),
      capabilities: () => {
        throw new TaskExecutionError('CAPABILITY_UNAVAILABLE')
      }
    })
    const response = await fetch(`${transport.baseUrl}/capabilities`, { headers })
    expect(response.status).toBe(503)
  })
})
