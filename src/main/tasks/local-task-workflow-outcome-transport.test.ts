import { request as httpRequest } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startLocalTaskTransport, TASK_TRANSPORT_MAX_BYTES } from './local-task-transport'
import { createLocalTaskServiceCredential } from './local-task-service-credential'
import { LocalTaskClient } from './local-task-client'
import { outcomeAccessFixture } from './task-workflow-outcome-access.test-fixture'
import { WORKFLOW_NATIVE_EVIDENCE_MAX_BYTES } from '../../shared/task-workflow/workflow-native-outcome'

const transports: Awaited<ReturnType<typeof startLocalTaskTransport>>[] = []
afterEach(async () => {
  await Promise.all(transports.splice(0).map((transport) => transport.close()))
})
async function fixture(commandCount = 0) {
  const f = await outcomeAccessFixture(commandCount)
  const credential = createLocalTaskServiceCredential(f.caller.operationCallerKey)
  const capabilities = vi.fn((): unknown => ({ kind: 'execution.capabilities' }))
  const transport = await startLocalTaskTransport({
    host: f.host,
    capabilities,
    authenticate: (bearer) => (credential.authenticate(bearer) ? f.caller : null)
  })
  transports.push(transport)
  const headers = {
    Authorization: `Bearer ${credential.secret}`,
    'Content-Type': 'application/json'
  }
  const client = new LocalTaskClient({ baseUrl: transport.baseUrl, secret: credential.secret })
  return { ...f, headers, client, baseUrl: transport.baseUrl, capabilities }
}
const routes = ['/execution/workflow-outcome', '/execution/workflow-commands']

describe('authenticated and bounded workflow outcome loopback transport', () => {
  it('returns the immutable outcome and commands larger than 64 KiB through the owned client', async () => {
    const f = await fixture(8)
    expect(Buffer.byteLength(JSON.stringify(f.commands))).toBeGreaterThan(TASK_TRANSPORT_MAX_BYTES)
    expect(await f.client.workflowOutcome(f.query)).toEqual(f.asset)
    expect(await f.client.workflowCommands(f.commandQuery)).toEqual(f.commands)
    expect(f.deps.launch).not.toHaveBeenCalled()
    expect(f.deps.stop).not.toHaveBeenCalled()
  })
  it.each(routes)('rejects unauthenticated %s before parsing or asset I/O', async (path) => {
    const f = await fixture()
    const response = await fetch(`${f.baseUrl}${path}`, { method: 'POST', body: 'invalid-json' })
    expect(response.status).toBe(401)
    expect(f.deps.workflowOutcomes!.read).not.toHaveBeenCalled()
    expect(f.deps.workflowOutcomes!.readCommands).not.toHaveBeenCalled()
  })
  it.each(routes)('rejects browser-origin and fetch-site headers on %s', async (path) => {
    const f = await fixture()
    const browserHeaders: Record<string, string>[] = [
      { Origin: 'https://example.invalid' },
      { 'Sec-Fetch-Site': 'same-origin' }
    ]
    for (const header of browserHeaders) {
      const response = await fetch(`${f.baseUrl}${path}`, {
        method: 'POST',
        headers: { ...f.headers, ...header },
        body: '{}'
      })
      expect(response.status).toBe(403)
    }
    expect(f.deps.workflowOutcomes!.read).not.toHaveBeenCalled()
    expect(f.deps.workflowOutcomes!.readCommands).not.toHaveBeenCalled()
  })
  it.each(routes)('retains the 64 KiB declared request limit on %s', async (path) => {
    const f = await fixture()
    const response = await fetch(`${f.baseUrl}${path}`, {
      method: 'POST',
      headers: f.headers,
      body: ' '.repeat(TASK_TRANSPORT_MAX_BYTES + 1)
    })
    expect(response.status).toBe(413)
    expect(f.deps.authorize).not.toHaveBeenCalled()
  })
  it.each(routes)('retains the 64 KiB chunked request limit on %s', async (path) => {
    const f = await fixture()
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        `${f.baseUrl}${path}`,
        { method: 'POST', headers: f.headers },
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
    expect(f.deps.authorize).not.toHaveBeenCalled()
  })
  it.each(routes)(
    'rejects missing JSON content type and malformed delivery metadata on %s',
    async (path) => {
      const f = await fixture()
      const noType = await fetch(`${f.baseUrl}${path}`, {
        method: 'POST',
        headers: { Authorization: f.headers.Authorization },
        body: '{}'
      })
      expect(noType.status).toBe(400)
      const delivery = await fetch(`${f.baseUrl}${path}`, {
        method: 'POST',
        headers: { ...f.headers, 'x-hive-delivery-generation': '1' },
        body: '{}'
      })
      expect(delivery.status).toBe(403)
      expect(f.deps.authorize).not.toHaveBeenCalled()
    }
  )
  it('keeps outcome and other routes at 64 KiB while bounding commands at 8 MiB', async () => {
    const f = await fixture(1)
    vi.mocked(f.deps.workflowOutcomes!.read).mockResolvedValueOnce({
      ...f.asset,
      outcome: {
        ...f.asset.outcome,
        artifacts: [{ name: 'x'.repeat(TASK_TRANSPORT_MAX_BYTES), version: f.asset.version }]
      }
    })
    const outcome = await fetch(`${f.baseUrl}/execution/workflow-outcome`, {
      method: 'POST',
      headers: f.headers,
      body: JSON.stringify(f.query)
    })
    expect(outcome.status).toBe(503)
    expect(await outcome.json()).toEqual({ error: { code: 'CAPACITY_EXCEEDED' } })
    f.capabilities.mockReturnValueOnce({ padding: 'x'.repeat(TASK_TRANSPORT_MAX_BYTES) })
    const capabilities = await fetch(`${f.baseUrl}/capabilities`, { headers: f.headers })
    expect(capabilities.status).toBe(503)
    const oversized = structuredClone(f.commands)
    if (oversized.kind !== 'available') {
      throw new Error('Fixture commands missing')
    }
    oversized.commands[0].output!.head = 'x'.repeat(WORKFLOW_NATIVE_EVIDENCE_MAX_BYTES)
    vi.mocked(f.deps.workflowOutcomes!.readCommands).mockResolvedValueOnce(oversized)
    const commands = await fetch(`${f.baseUrl}/execution/workflow-commands`, {
      method: 'POST',
      headers: f.headers,
      body: JSON.stringify(f.commandQuery)
    })
    expect(commands.status).toBe(503)
    expect(await commands.json()).toEqual({ error: { code: 'CAPACITY_EXCEEDED' } })
  })
  it('refuses owner revocation during outcome I/O without returning private facts', async () => {
    const f = await fixture()
    vi.mocked(f.deps.workflowOutcomes!.read).mockImplementationOnce(async () => {
      await Promise.resolve()
      f.revokeOwner()
      return f.asset
    })
    await expect(f.client.workflowOutcome(f.query)).rejects.toThrow('FORBIDDEN')
  })
})
