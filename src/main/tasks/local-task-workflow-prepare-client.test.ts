import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startLocalTaskTransport } from './local-task-transport'
import { LocalTaskClient } from './local-task-client'
import { createLocalTaskServiceCredential } from './local-task-service-credential'
import { TaskExecutionError } from './task-execution-error'

const refs = {
  projectId: randomUUID(),
  caseId: randomUUID(),
  taskId: randomUUID(),
  runId: randomUUID()
}
const transports: Awaited<ReturnType<typeof startLocalTaskTransport>>[] = []
afterEach(async () => {
  await Promise.all(transports.splice(0).map((transport) => transport.close()))
})
function clientFor(body: unknown) {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body)))
  return {
    client: new LocalTaskClient({
      baseUrl: 'http://127.0.0.1:12345',
      secret: 'a'.repeat(43),
      fetch: fetchImpl
    }),
    fetchImpl
  }
}

describe('private refs-only workflow preparation client', () => {
  it('round-trips only refs through the authenticated private transport callback', async () => {
    const credential = createLocalTaskServiceCredential('trusted-local:runtime')
    const unavailable = vi.fn(async () => {
      throw new TaskExecutionError('CAPABILITY_UNAVAILABLE')
    })
    const prepareCaseRun = vi.fn(async (value: unknown) => value)
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
      prepareCaseRun
    })
    transports.push(transport)
    const client = new LocalTaskClient({ baseUrl: transport.baseUrl, secret: credential.secret })
    expect(await client.prepareCaseRun(refs)).toEqual(refs)
    expect(prepareCaseRun).toHaveBeenCalledWith(
      refs,
      expect.objectContaining({ operationCallerKey: 'trusted-local:runtime' })
    )
    expect(unavailable).not.toHaveBeenCalled()
  })
  it.each([
    'accountId',
    'command',
    'workflowContext',
    'workspaceSelector',
    'dockerProof',
    'dispatch',
    'path'
  ])('refuses caller supplied %s before any HTTP', async (field) => {
    const { client, fetchImpl } = clientFor(refs)
    await expect(client.prepareCaseRun({ ...refs, [field]: true })).rejects.toThrow(
      'INVALID_REQUEST'
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it.each(['projectId', 'caseId', 'taskId', 'runId'] as const)(
    'refuses a foreign %s ACK',
    async (field) => {
      await expect(
        clientFor({ ...refs, [field]: randomUUID() }).client.prepareCaseRun(refs)
      ).rejects.toThrow('OUTCOME_UNKNOWN')
    }
  )
  it('refuses an ACK that smuggles an execution grant', async () => {
    await expect(clientFor({ ...refs, binding: {} }).client.prepareCaseRun(refs)).rejects.toThrow(
      'OUTCOME_UNKNOWN'
    )
  })
})
