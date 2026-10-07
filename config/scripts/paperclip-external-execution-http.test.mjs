import { once } from 'node:events'
import { randomUUID, createHash } from 'node:crypto'
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { spawnProcess } from '../../src/shared/child-process/run-process.ts'
import { createPostgresTaskHarness } from './paperclip-task-repository-postgres-fixture.mjs'
import { workflowTestVectors } from '../../src/shared/task-workflow/workflow.test-fixture.ts'

const configPath = process.env.HIVE_PAPERCLIP_P2_POSTGRES_CONFIG

/** Real restricted HTTP, PostgreSQL and service processes; Runtime unavailability is explicit. */
describe.skipIf(!configPath)('external observer control through the restricted service', () => {
  let h, config, directory, descriptorPath, bootstrap, service, descriptor
  const processes = []
  beforeAll(async () => {
    h = await createPostgresTaskHarness(configPath)
    config = JSON.parse(await readFile(configPath, 'utf8'))
    const bundle = resolve('out/paperclip-service/server.mjs')
    const build = JSON.parse(await readFile('logs/p1-closeout/service-build.json', 'utf8'))
    expect(
      createHash('sha256')
        .update(await readFile(bundle))
        .digest('hex')
    ).toBe(build.sha256)
    expect(build.providerPackagesBundled).toEqual([])
    const root = resolve('logs/paperclip-development/p2/core-controller-http')
    await mkdir(root, { recursive: true })
    directory = await mkdtemp(join(root, 'service-'))
    descriptorPath = join(directory, 'descriptor.json')
    const runtimeDescriptor = join(directory, 'runtime-unavailable.json')
    await writeFile(
      runtimeDescriptor,
      JSON.stringify({ baseUrl: 'http://127.0.0.1:1', secret: 'x'.repeat(43) }),
      { mode: 0o600 }
    )
    bootstrap = join(directory, 'test-process.mjs')
    await writeFile(
      bootstrap,
      `await import(${JSON.stringify(pathToFileURL(bundle).href)});\nprocess.on('message', value => { if(value?.action === 'close-test-process') process.emit('SIGTERM') });\n`
    )
    config.runtimeDescriptor = runtimeDescriptor
    await start()
  })
  afterAll(async () => {
    for (const entry of processes) {
      if (entry.child.exitCode === null && entry.child.signalCode === null) {
        entry.child.send({ action: 'close-test-process' })
        try {
          await vi.waitFor(() => expect(entry.closed).toBe(true), { timeout: 10_000 })
        } finally {
          if (!entry.closed) {
            entry.child.kill('SIGKILL')
            await entry.exit
          }
        }
      }
      await writeFile(join(directory, `process-${entry.index}.log`), entry.output)
    }
    await h?.close()
  })
  async function start() {
    const child = spawnProcess({
      program: process.execPath,
      args: [bootstrap],
      cwd: resolve('.'),
      env: {
        ...process.env,
        ORCA_BACKGROUND_LAUNCH: '1',
        HIVE_PAPERCLIP_SERVICE_DESCRIPTOR: descriptorPath,
        HIVE_PAPERCLIP_DATABASE_URL: config.databaseUrl,
        HIVE_TASK_TRANSPORT_DESCRIPTOR: config.runtimeDescriptor
      },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc']
    })
    const entry = { child, index: processes.length, output: '', closed: false }
    child.on('error', () => {})
    for (const stream of [child.stdin, child.stdout, child.stderr]) {
      stream.on('error', () => {})
    }
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (chunk) => {
        if (entry.output.length < 64 * 1024) {
          entry.output += String(chunk)
        }
      })
    }
    entry.exit = once(child, 'close').then(() => {
      entry.closed = true
    })
    processes.push(entry)
    service = entry
    await vi.waitFor(
      async () => {
        const current = JSON.parse(await readFile(descriptorPath, 'utf8'))
        expect(await request('/hive/health', undefined, {}, current)).toMatchObject({
          status: 200,
          body: { databaseReady: true }
        })
        descriptor = current
      },
      { timeout: 20_000, interval: 100 }
    )
  }
  async function request(path, body, headers = {}, authority = descriptor) {
    const response = await fetch(`${authority.baseUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${authority.secret}`,
        'Content-Type': 'application/json',
        ...headers
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000)
    })
    return { status: response.status, body: await response.json() }
  }
  const pathFor = (task) => `/hive/external-execution/${task.company_id}/${task.run_id}`

  it('rejects foreign credentials, browser origins, account headers and execution fields before writes', async () => {
    const context = await h.newTask(),
      path = pathFor(context.task)
    const before = await h.snapshot(context)
    for (const headers of [
      { Authorization: `Bearer ${'z'.repeat(43)}` },
      { Origin: 'https://example.invalid' },
      { 'Sec-Fetch-Site': 'same-origin' },
      { 'X-Hive-Account-Id': context.accountId }
    ]) {
      expect((await request(path, { action: 'cancel' }, headers)).status).toBe(403)
    }
    for (const body of [
      { action: 'start' },
      { action: 'recover', accountId: context.accountId },
      { action: 'cancel', binding: context.binding },
      { action: 'drain', reason: 'caller-reported' }
    ]) {
      expect((await request(path, body)).status).toBe(400)
    }
    expect((await request(path)).status).toBe(403)
    expect(
      (
        await request(`/hive/external-execution/${randomUUID()}/${context.task.run_id}`, {
          action: 'cancel'
        })
      ).status
    ).toBe(403)
    expect((await request('/api/agents', { adapterType: 'codex_local' })).status).toBe(403)
    expect(await h.snapshot(context)).toEqual(before)
  })

  async function newHttpWorkflow() {
    const accountId = `workflow-http:${randomUUID()}`
    const headers = { 'X-Hive-Account-Id': accountId }
    const company = await request(
      '/hive/workbench/companies/create',
      {
        requestId: randomUUID(),
        name: 'HTTP workflow company'
      },
      headers
    )
    expect(company.status).toBe(201)
    const project = await request(
      '/hive/workbench/projects/create',
      {
        requestId: randomUUID(),
        companyId: company.body.id,
        name: 'HTTP workflow project',
        workspaceSelector: 'folder:http-fixture',
        hiveWorkspaceRef: `workspace:${randomUUID()}`
      },
      headers
    )
    expect(project.status).toBe(201)
    const input = {
      requestId: randomUUID(),
      projectId: project.body.id,
      expectedRevision: 0,
      expectedProjectRevision: 1,
      name: 'HTTP engineering flow',
      stages: workflowTestVectors.examples.definition.stages,
      maxParallelism: 1,
      maxDurationMs: 60_000
    }
    const saved = await request('/hive/workbench/workflows/save', input, headers)
    expect(saved.status).toBe(200)
    expect(saved.body.definition.scope).toEqual({
      companyRef: company.body.id,
      projectRef: project.body.id
    })
    expect(saved.body.definition.workflowRevision).toBe(1)
    return {
      saved,
      input,
      headers,
      query: { projectId: project.body.id, workflowId: saved.body.workflowId }
    }
  }

  it('saves and reads a scoped immutable engineering definition through actual restricted HTTP', async () => {
    const { saved, input, headers, query } = await newHttpWorkflow()
    expect(await request('/hive/workbench/workflows/save', input, headers)).toEqual(saved)
    expect(await request('/hive/workbench/workflows/read', query, headers)).toEqual(saved)
    expect(
      (await request('/hive/workbench/workflows/list', { projectId: query.projectId }, headers))
        .body
    ).toEqual({ items: [saved.body], nextCursor: null })
    expect(
      (
        await request('/hive/workbench/workflows/read', query, {
          'X-Hive-Account-Id': `foreign:${randomUUID()}`
        })
      ).status
    ).toBe(403)
    expect(
      (
        await request(
          '/hive/workbench/workflows/save',
          { ...input, executionPolicy: 'trusted_personal_preview' },
          headers
        )
      ).status
    ).toBe(400)
    expect((await request('/hive/workbench/workflows/dispatch', query, headers)).status).toBe(403)
    const emptyCriteria = structuredClone(input)
    emptyCriteria.requestId = randomUUID()
    emptyCriteria.stages[1].acceptanceCriteria = [' \t']
    expect(await request('/hive/workbench/workflows/save', emptyCriteria, headers)).toMatchObject({
      status: 400,
      body: { error: { code: 'INVALID_REQUEST' } }
    })
    expect(
      (await request('/hive/workbench/workflows/list', { projectId: query.projectId }, headers))
        .body
    ).toEqual({
      items: [saved.body],
      nextCursor: null
    })
  })

  it('persists a per-run handoff and cancellation across an owned process crash without inventing terminal proof', async () => {
    const workflowContext = await newHttpWorkflow()
    const context = await h.newTask(),
      path = pathFor(context.task)
    expect(await request(path, { action: 'drain' })).toEqual({
      status: 202,
      body: {
        accepted: true,
        companyId: context.task.company_id,
        runId: context.task.run_id,
        action: 'drain',
        retained: true
      }
    })
    expect((await request(path, { action: 'recover' })).status).toBe(503)
    expect((await request(path, { action: 'cancel' })).status).toBe(503)
    const before = await h.snapshot(context)
    expect(before.task.cancel_requested).toBe(true)
    expect(before.task.result_receipt).toBeNull()
    expect(before.task.checkout_run_id).toBe(context.task.run_id)
    expect(before.run.finished_at).toBeNull()
    const [intent] =
      await h.sql`SELECT context_snapshot FROM heartbeat_runs WHERE id=${context.task.run_id}`
    expect(intent.context_snapshot.externalExecutionControl).toHaveProperty('cancel')
    expect(intent.context_snapshot.externalExecutionControl).toHaveProperty('drain')
    const previous = descriptor
    expect(service.child.kill('SIGKILL')).toBe(true)
    await service.exit
    await start()
    expect(
      await request(
        '/hive/workbench/workflows/read',
        workflowContext.query,
        workflowContext.headers
      )
    ).toEqual(workflowContext.saved)
    expect(descriptor.secret).not.toBe(previous.secret)
    expect(
      (await request('/hive/health', undefined, { Authorization: `Bearer ${previous.secret}` }))
        .status
    ).toBe(403)
    expect((await request(path, { action: 'recover' })).status).toBe(503)
    expect(await h.snapshot(context)).toEqual(before)
    const [after] =
      await h.sql`SELECT context_snapshot FROM heartbeat_runs WHERE id=${context.task.run_id}`
    expect(after.context_snapshot).toEqual(intent.context_snapshot)
    await writeFile(
      join(directory, 'restart-evidence.json'),
      JSON.stringify(
        {
          forcedOwnedProcessExited: true,
          freshServiceAuthenticated: true,
          oldCredentialRejected: true,
          intentAndOriginalSlotRetained: true,
          runtimeUnavailable: true,
          runtimeExecutionTested: false
        },
        null,
        2
      )
    )
  })

  it.skipIf(!process.env.HIVE_PAPERCLIP_SOURCE)(
    'routes the actual core observer HTTP port into the private gateway mapping',
    async () => {
      const module = await import(
        pathToFileURL(
          resolve(
            process.env.HIVE_PAPERCLIP_SOURCE,
            'server/src/services/external-execution-http.ts'
          )
        ).href
      )
      const port = module.createExternalExecutionHttpPort({ descriptorPath })
      const context = await h.newTask()
      const run = {
        id: context.task.run_id,
        companyId: context.task.company_id,
        driverKind: 'hive_runtime',
        status: 'queued'
      }
      await port.drain(run, 'core_shutdown')
      const retained = await h.snapshot(context)
      expect(retained.task.cancel_requested).toBe(false)
      expect(retained.task.result_receipt).toBeNull()
      expect(retained.task.checkout_run_id).toBe(run.id)
      await expect(port.recover(run)).rejects.toThrow('EXTERNAL_RUNTIME_UNAVAILABLE')
      await expect(port.cancel(run, 'core_cancel')).rejects.toThrow('EXTERNAL_RUNTIME_UNAVAILABLE')
      const cancelled = await h.snapshot(context)
      expect(cancelled.task.cancel_requested).toBe(true)
      expect(cancelled.task.result_receipt).toBeNull()
      expect(cancelled.task.checkout_run_id).toBe(run.id)
      expect(cancelled.run.finished_at).toBeNull()
      expect(cancelled.run.result_json).toBeNull()
    }
  )
})
