import { randomUUID } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startLocalTaskTransport, TASK_TRANSPORT_MAX_BYTES } from './local-task-transport'
import { createLocalTaskServiceCredential } from './local-task-service-credential'
import { TaskExecutionError } from './task-execution-error'

const refs = {
  projectId: randomUUID(),
  caseId: randomUUID(),
  applicationRef: randomUUID(),
  taskId: randomUUID(),
  runId: randomUUID()
}
const transports: Awaited<ReturnType<typeof startLocalTaskTransport>>[] = []
afterEach(async () => {
  await Promise.all(transports.splice(0).map((transport) => transport.close()))
})
async function fixture() {
  const credential = createLocalTaskServiceCredential('trusted-local:runtime')
  const unavailable = vi.fn(async () => {
    throw new TaskExecutionError('CAPABILITY_UNAVAILABLE')
  })
  const preparePlanRun = vi.fn(async () => refs)
  const transport = await startLocalTaskTransport({
    host: {
      start: unavailable,
      observe: unavailable,
      cancel: unavailable,
      reconcile: unavailable,
      workflowOutcome: unavailable,
      workflowCommands: unavailable,
      workflowArtifact: unavailable
    },
    authenticate: credential.authenticate,
    capabilities: () => ({}),
    preparePlanRun
  })
  transports.push(transport)
  return {
    transport,
    unavailable,
    preparePlanRun,
    url: `${transport.baseUrl}/execution/workflow-plan-prepare`,
    headers: { Authorization: `Bearer ${credential.secret}`, 'Content-Type': 'application/json' }
  }
}
describe('private Main preparation HTTP protections', () => {
  it('rejects missing authentication before parsing or preparation', async () => {
    const f = await fixture(),
      response = await fetch(f.url, { method: 'POST', body: 'invalid JSON' })
    expect(response.status).toBe(401)
    expect(f.preparePlanRun).not.toHaveBeenCalled()
  })
  it.each(['Origin', 'Sec-Fetch-Site'])('rejects browser %s before preparation', async (header) => {
    const f = await fixture(),
      response = await fetch(f.url, {
        method: 'POST',
        headers: { ...f.headers, [header]: 'https://foreign.invalid' },
        body: JSON.stringify(refs)
      })
    expect(response.status).toBe(403)
    expect(f.preparePlanRun).not.toHaveBeenCalled()
  })
  it('retains the declared request size bound', async () => {
    const f = await fixture(),
      response = await fetch(f.url, {
        method: 'POST',
        headers: f.headers,
        body: 'x'.repeat(TASK_TRANSPORT_MAX_BYTES + 1)
      })
    expect(response.status).toBe(413)
    expect(f.preparePlanRun).not.toHaveBeenCalled()
  })
  it('retains the chunked request size bound', async () => {
    const f = await fixture()
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(f.url, { method: 'POST', headers: f.headers }, (response) => {
        response.resume()
        response.on('end', () => resolve(response.statusCode!))
      })
      request.on('error', reject)
      request.write('x'.repeat(TASK_TRANSPORT_MAX_BYTES))
      request.end('x')
    })
    expect(status).toBe(413)
    expect(f.preparePlanRun).not.toHaveBeenCalled()
  })
  it.each(['accountId', 'authorizationRef', 'workflowContext', 'path', 'ownerProof'])(
    'rejects additional %s before native work',
    async (field) => {
      const f = await fixture(),
        response = await fetch(f.url, {
          method: 'POST',
          headers: f.headers,
          body: JSON.stringify({ ...refs, [field]: true })
        })
      expect(response.status).toBe(400)
      expect(f.preparePlanRun).not.toHaveBeenCalled()
      expect(f.unavailable).not.toHaveBeenCalled()
    }
  )
  it('rejects malformed delivery metadata and a swapped ACK', async () => {
    const f = await fixture()
    const delivery = await fetch(f.url, {
      method: 'POST',
      headers: { ...f.headers, 'x-hive-delivery-generation': '1' },
      body: JSON.stringify(refs)
    })
    expect(delivery.status).toBe(403)
    f.preparePlanRun.mockResolvedValueOnce({ ...refs, runId: randomUUID() })
    const reply = await fetch(f.url, {
      method: 'POST',
      headers: f.headers,
      body: JSON.stringify(refs)
    })
    expect(reply.status).toBe(409)
    expect(await reply.json()).toEqual({ error: { code: 'OUTCOME_UNKNOWN' } })
  })
})
