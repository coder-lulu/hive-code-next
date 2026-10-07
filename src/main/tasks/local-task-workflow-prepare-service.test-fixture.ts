import { createServer } from 'node:http'
import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { HiveRuntimeAdapterBinding, type HiveRuntimeBinding } from './paperclip-adapter-contract'
import { canonicalAgentSessionDigest as digest } from '../../shared/agent-session-mutation-envelope'
import { TaskExecutionError } from './task-execution-error'
import { vi } from 'vitest'

export function workflowPrepareBindingCommit<
  Task extends {
    binding: HiveRuntimeBinding | null
    status: string
    status_version: number
    run_id: string
  }
>(task: Task, stage: { status: string; taskRevision: number }) {
  const bindingWrite = vi.fn<() => void>()
  const bindingCommit = vi.fn(async (body: HiveRuntimeBinding) => {
    if (task.binding) {
      const immutable = (value: HiveRuntimeBinding) => ({
        ...value,
        command: { ...value.command, expiresAt: null }
      })
      if (digest(immutable(task.binding)) !== digest(immutable(body))) {
        throw new TaskExecutionError('IDEMPOTENCY_CONFLICT')
      }
      return task
    }
    bindingWrite()
    task.binding = body
    task.status = 'in_progress'
    task.status_version += 1
    stage.taskRevision += 1
    stage.status = 'in_progress'
    Object.assign(task, {
      checkout_run_id: task.run_id,
      execution_locked_at: new Date().toISOString()
    })
    return task
  })
  return { bindingWrite, bindingCommit }
}

export async function startWorkflowPrepareUnitService(options: {
  directory: string
  accountId(): string | undefined
  team: unknown
  view: unknown
  admission: unknown
  task: unknown
  runId: string
  bindingCommit(value: HiveRuntimeBinding): Promise<unknown>
  beforeTaskRead?(): Promise<void>
  requests: { path: string; body: unknown }[]
}) {
  const serviceSecret = 'b'.repeat(43)
  const service = createServer(async (request, response) => {
    try {
      if (
        request.headers.authorization !== `Bearer ${serviceSecret}` ||
        request.headers['x-hive-account-id'] !== options.accountId()
      ) {
        response.writeHead(403)
        response.end(JSON.stringify({ error: { code: 'FORBIDDEN' } }))
        return
      }
      const bytes: Buffer[] = []
      for await (const chunk of request) {
        bytes.push(Buffer.from(chunk))
      }
      const body = bytes.length ? JSON.parse(Buffer.concat(bytes).toString('utf8')) : undefined
      const path = request.url!
      options.requests.push({ path, body })
      if (path.endsWith(`/runs/${options.runId}`)) {
        await options.beforeTaskRead?.()
      }
      const value = path.endsWith('/team/read')
        ? options.team
        : path.endsWith('/cases/read')
          ? options.view
          : path.endsWith('/cases/run-read')
            ? options.admission
            : path.endsWith('/binding')
              ? await options.bindingCommit(HiveRuntimeAdapterBinding.parse(body))
              : path.endsWith(`/runs/${options.runId}`)
                ? options.task
                : undefined
      if (value === undefined) {
        throw new Error('No dispatch callback is permitted during preparation')
      }
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(value))
    } catch {
      response.writeHead(503)
      response.end(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE' } }))
    }
  })
  service.listen(0, '127.0.0.1')
  await once(service, 'listening')
  const address = service.address()
  if (!address || typeof address === 'string') {
    throw new Error('Missing unit HTTP address')
  }
  await writeFile(
    join(options.directory, 'paperclip.json'),
    JSON.stringify({ baseUrl: `http://127.0.0.1:${address.port}`, secret: serviceSecret }),
    { mode: 0o600 }
  )
  return {
    async close() {
      service.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        service.close((error) => (error ? reject(error) : resolve()))
      )
    }
  }
}
