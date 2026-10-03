import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHiveTaskFacade } from './hive-task-facade'
import { TaskArtifactIndex } from './task-artifact-index'
import { taskCommand, taskTestDirectory } from './task-execution.test-fixture'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-publication'

let directory: string
beforeEach(async () => {
  directory = await taskTestDirectory()
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})
async function fixture() {
  const descriptorPath = join(directory, 'paperclip.json')
  await writeFile(
    descriptorPath,
    JSON.stringify({ baseUrl: 'http://127.0.0.1:1234', secret: 'x'.repeat(43) })
  )
  let account: HiveRuntimeCloudAuthorization | null = {
    accountId: 'test-account',
    authorityId: 'test-authority',
    accessToken: 'test-token',
    sessionGeneration: 1,
    sessionExpiresAt: Date.now() + 60_000
  }
  const task = {
    id: randomUUID(),
    company_id: randomUUID(),
    agent_id: randomUUID(),
    run_id: randomUUID(),
    title: 'Report',
    description: 'Produce report.md',
    workspace_selector: 'folder:source',
    status: 'todo',
    status_version: 0,
    result_receipt: null,
    cancel_requested: false,
    binding: null
  }
  const input = {
    requestId: randomUUID(),
    title: task.title,
    input: task.description,
    workspaceSelector: task.workspace_selector
  }
  const request = vi.fn(async (_path: string, _body?: unknown): Promise<unknown> => task)
  const requestFactory = vi.fn(() => request)
  const issue = vi.fn(async () => ({
    bindingRef: 'binding:test',
    paperclipCompanyId: task.company_id,
    paperclipAgentId: task.agent_id,
    command: taskCommand(),
    commandFingerprint: 'a'.repeat(64)
  }))
  const facade = createHiveTaskFacade({
    descriptorPath,
    artifacts: new TaskArtifactIndex(join(directory, 'artifacts')),
    issuer: { issue },
    currentAccount: () => account,
    assertCurrent: () => undefined,
    validateWorkspace: async () => ({ assertCurrent: () => undefined }),
    request: requestFactory
  })
  return {
    facade,
    issue,
    task,
    input,
    request,
    requestFactory,
    setAccount: (value: typeof account) => {
      account = value
    }
  }
}
describe('authenticated Hive task Facade', () => {
  it('persists the business task and binding before dispatch, returning only presentation data', async () => {
    const f = await fixture()
    const result = await f.facade.create(f.input)
    expect(f.request.mock.calls.map(([path]) => path)).toEqual([
      '/hive/tasks',
      `/hive/tasks/${f.task.id}/binding`,
      `/hive/tasks/${f.task.id}/dispatch`
    ])
    expect(f.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        paperclipCompanyId: f.task.company_id,
        task: expect.objectContaining({
          taskId: f.task.id,
          runId: f.task.run_id,
          taskRevision: '0'
        })
      })
    )
    expect(result).toEqual({ id: f.task.id, title: 'Report', status: 'pending', artifactRefs: [] })
    expect(f.requestFactory).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { 'X-Hive-Account-Id': 'test-account' } })
    )
  })
  it('refuses signed-out work before any business write or binding issue', async () => {
    const f = await fixture()
    f.setAccount(null)
    await expect(f.facade.create(f.input)).rejects.toThrow('FORBIDDEN')
    expect(f.request).not.toHaveBeenCalled()
    expect(f.issue).not.toHaveBeenCalled()
  })
  it('rejects an account switch during a backend reply before issuing or returning data', async () => {
    const f = await fixture()
    f.request.mockImplementation(async () => {
      f.setAccount(null)
      return f.task
    })
    await expect(f.facade.create(f.input)).rejects.toThrow('FORBIDDEN')
    expect(f.issue).not.toHaveBeenCalled()
  })
  it('rejects artifact references absent from the committed task receipt', async () => {
    const f = await fixture()
    await expect(f.facade.artifact(f.task.id, `artifact:${'a'.repeat(64)}`)).rejects.toThrow(
      'FORBIDDEN'
    )
  })
})
