import { createServer } from 'node:http'
import { once } from 'node:events'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import postgres from '@hive-paperclip-postgres'
import { HIVE_WORKFLOW_CASE_MAX_REQUEST_BYTES } from '../../../src/shared/hive-workflow-cases.ts'
import { applyPendingMigrations } from '@hive-paperclip-db'
import { createTaskRepository } from './task-repository.mjs'
import { createTaskDispatch } from './task-dispatch.mjs'
import { reconcilePaperclipMigrationHashes } from './migration-history.mjs'
import { createTeamWorkbenchRepository } from './team-workbench-repository.mjs'
import { createWorkflowDefinitionRepository } from './workflow-definition-repository.mjs'
import { createWorkflowCaseRepository } from './workflow-case-repository.mjs'
import { WORKBENCH_PATHS, handleTeamWorkbenchRequest } from './team-workbench-routes.mjs'
import {
  EXTERNAL_EXECUTION_PATH,
  handleExternalExecutionControl
} from './external-execution-control.mjs'
import manifest from '../compatibility-manifest.json' with { type: 'json' }

const Input = z.strictObject({
  requestId: z.string().uuid(),
  title: z.string().min(1).max(240),
  input: z.string().min(1).max(48_000),
  workspaceSelector: z.string().min(1).max(512)
})
const Empty = z.strictObject({})
const send = (response, status, value) => {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(value))
}
const descriptor = process.env.HIVE_PAPERCLIP_SERVICE_DESCRIPTOR
const databaseUrl = process.env.HIVE_PAPERCLIP_DATABASE_URL
if (!descriptor || !databaseUrl || !process.env.HIVE_TASK_TRANSPORT_DESCRIPTOR) {
  throw new Error('Hive task service configuration is required')
}
// Existing Paperclip migrations own companies/issues/agents/heartbeat_runs in this independent DB.
const sql = postgres(databaseUrl, { max: 4, onnotice: () => {} })
await reconcilePaperclipMigrationHashes(sql, new URL('./migrations', import.meta.url))
await applyPendingMigrations(databaseUrl)
await sql.unsafe(await readFile(new URL('./task-tables.sql', import.meta.url), 'utf8'))
await sql.unsafe(await readFile(new URL('./task-run-migration.sql', import.meta.url), 'utf8'))
await sql.unsafe(await readFile(new URL('./team-workbench-tables.sql', import.meta.url), 'utf8'))
await sql.unsafe(
  await readFile(new URL('./workflow-definition-tables.sql', import.meta.url), 'utf8')
)
await sql.unsafe(await readFile(new URL('./workflow-case-tables.sql', import.meta.url), 'utf8'))
const repository = createTaskRepository(sql),
  dispatch = createTaskDispatch(repository)
const workbenchRepository = {
  ...createTeamWorkbenchRepository(sql),
  ...createWorkflowDefinitionRepository(sql),
  ...createWorkflowCaseRepository(sql)
}
const secret = randomBytes(32).toString('base64url'),
  expected = Buffer.from(secret)
let authority = '',
  closed = false
const server = createServer(async (request, response) => {
  try {
    const token = request.headers.authorization?.slice('Bearer '.length) ?? ''
    if (
      closed ||
      request.headers.host !== authority ||
      request.headers.origin ||
      request.headers['sec-fetch-site'] ||
      !request.headers.authorization?.startsWith('Bearer ') ||
      !/^[A-Za-z0-9_-]{43}$/.test(token) ||
      !timingSafeEqual(Buffer.from(token), expected)
    ) {
      send(response, 403, { error: { code: 'FORBIDDEN' } })
      return
    }
    if (request.url === '/hive/health' && request.method === 'GET') {
      await sql`SELECT 1`
      send(response, 200, {
        protocolVersion: manifest.protocolVersion,
        paperclipRevision: manifest.paperclip.revision,
        executionAllowlist: ['hive_runtime'],
        databaseReady: true
      })
      return
    }
    const accountId = request.headers['x-hive-account-id']
    const control = request.url?.match(EXTERNAL_EXECUTION_PATH)
    if (
      control
        ? accountId !== undefined
        : typeof accountId !== 'string' || !accountId || accountId.length > 512
    ) {
      send(response, 403, { error: { code: 'FORBIDDEN' } })
      return
    }
    const delivery = request.url?.match(
      /^\/hive\/execution-delivery\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/
    )
    if (delivery && request.method === 'GET') {
      const companyId = z.string().uuid().parse(delivery[1])
      const runId = z.string().uuid().parse(delivery[2])
      send(response, 200, await repository.getCurrentDelivery(accountId, companyId, runId))
      return
    }
    const route = request.url?.match(
      /^\/hive\/tasks(?:\/([0-9a-f-]{36})\/runs\/([0-9a-f-]{36})(?:\/(binding|dispatch|cancel))?)?$/
    )
    const workbench = WORKBENCH_PATHS.includes(request.url)
    if (!route && !workbench && !control) {
      send(response, 403, { error: { code: 'FORBIDDEN' } })
      return
    }
    const taskId = route?.[1],
      runId = route?.[2],
      action = route?.[3]
    if (!workbench && !control && request.method === 'GET' && !action) {
      send(
        response,
        200,
        taskId ? await repository.read(accountId, taskId, runId) : await repository.list(accountId)
      )
      return
    }
    if (request.method !== 'POST' || request.headers['content-type'] !== 'application/json') {
      send(response, 403, { error: { code: 'FORBIDDEN' } })
      return
    }
    const chunks = []
    // 48,000 JSON-escaped requirement characters plus bounded case metadata fit in 320 KiB.
    const maximumBodyBytes =
      request.url === '/hive/workbench/cases/create'
        ? HIVE_WORKFLOW_CASE_MAX_REQUEST_BYTES
        : 64 * 1024
    let length = 0
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      length += chunk.length
      if (length > maximumBodyBytes) {
        request.resume()
        send(response, 413, { error: { code: 'INVALID_REQUEST' } })
        return
      }
      chunks.push(chunk)
    }
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
    if (control) {
      send(
        response,
        202,
        await handleExternalExecutionControl(repository, dispatch, control[1], control[2], body)
      )
      return
    }
    if (workbench) {
      const result = await handleTeamWorkbenchRequest(
        workbenchRepository,
        accountId,
        request.url,
        body
      )
      const createsObject = request.url.endsWith('/create')
      send(response, createsObject ? 201 : 200, result)
      return
    }
    if (!taskId && !action) {
      send(response, 201, await repository.create(accountId, Input.parse(body)))
      return
    }
    if (taskId && action === 'binding') {
      send(response, 200, await repository.bind(accountId, taskId, runId, body))
      return
    }
    if (taskId && action === 'dispatch') {
      Empty.parse(body)
      await dispatch.start(accountId, taskId, runId)
      send(response, 202, { accepted: true })
      return
    }
    if (taskId && action === 'cancel') {
      Empty.parse(body)
      const result = await repository.cancel(accountId, taskId, runId)
      void dispatch.cancel(accountId, taskId, runId).catch(() => {})
      send(response, 202, result)
      return
    }
    send(response, 403, { error: { code: 'FORBIDDEN' } })
  } catch (error) {
    const code =
      error instanceof z.ZodError || error instanceof SyntaxError || error instanceof TypeError
        ? 'INVALID_REQUEST'
        : [
              'FORBIDDEN',
              'INVALID_REQUEST',
              'IDEMPOTENCY_CONFLICT',
              'REVISION_CONFLICT',
              'OUTCOME_UNKNOWN',
              'SEQUENCE_GAP'
            ].includes(error.code)
          ? error.code
          : 'SERVICE_UNAVAILABLE'
    send(
      response,
      code === 'FORBIDDEN'
        ? 403
        : code === 'INVALID_REQUEST'
          ? 400
          : code === 'SERVICE_UNAVAILABLE'
            ? 503
            : 409,
      { error: { code } }
    )
  }
})
server.requestTimeout = 10_000
server.headersTimeout = 10_000
server.keepAliveTimeout = 1000
server.listen(0, '127.0.0.1')
await once(server, 'listening')
authority = `127.0.0.1:${server.address().port}`
await mkdir(dirname(descriptor), { recursive: true, mode: 0o700 })
await writeFile(descriptor, JSON.stringify({ baseUrl: `http://${authority}`, secret }), {
  mode: 0o600
})
console.log('Restricted Paperclip task service ready; adapter allowlist: hive_runtime')
dispatch.startRecovery()
let shutdown
const close = () =>
  (shutdown ??= (async () => {
    closed = true
    server.closeAllConnections()
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
    await dispatch.close()
    await sql.end({ timeout: 5 })
    await unlink(descriptor).catch(() => {})
  })())
process.on('SIGTERM', () => void close().then(() => process.exit(0)))
process.on('SIGINT', () => void close().then(() => process.exit(0)))
