import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
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
  const artifactDirectory = join(directory, 'artifacts')
  const { facade } = createHiveTaskFacade({
    descriptorPath,
    codeInspection: null,
    sessionInspection: null,
    artifacts: new TaskArtifactIndex(artifactDirectory),
    issuer: { issue },
    currentAccount: () => account,
    assertCurrent: () => undefined,
    validateWorkspace: async () => ({
      workspaceRef: 'workspace:test',
      assertCurrent: () => undefined
    }),
    request: requestFactory
  })
  return {
    facade,
    issue,
    task,
    input,
    request,
    requestFactory,
    artifactDirectory,
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
      `/hive/tasks/${f.task.id}/runs/${f.task.run_id}/binding`,
      `/hive/tasks/${f.task.id}/runs/${f.task.run_id}/dispatch`
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
    expect(result).toEqual({
      id: f.task.id,
      runId: f.task.run_id,
      title: 'Report',
      status: 'pending',
      artifactRefs: []
    })
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
    await expect(
      f.facade.artifact(f.task.id, f.task.run_id, `artifact:${'a'.repeat(64)}`)
    ).rejects.toThrow('FORBIDDEN')
    expect(f.request).toHaveBeenCalledWith(
      `/hive/tasks/${f.task.id}/runs/${f.task.run_id}`,
      undefined
    )
  })
  it('projects the run that belongs to each list row', async () => {
    const f = await fixture()
    const nextRun = randomUUID()
    f.request.mockResolvedValue([f.task, { ...f.task, run_id: nextRun }])
    expect((await f.facade.list()).map(({ runId }) => runId)).toEqual([f.task.run_id, nextRun])
  })
  it('addresses a cancellation to the displayed run, even after another attempt exists', async () => {
    const f = await fixture()
    const result = await f.facade.cancel(f.task.id, f.task.run_id)
    expect(f.request).toHaveBeenCalledWith(
      `/hive/tasks/${f.task.id}/runs/${f.task.run_id}/cancel`,
      {}
    )
    expect(result.runId).toBe(f.task.run_id)
    expect(f.issue).not.toHaveBeenCalled()
  })
  it('rejects another run returned for cancellation or artifact authorization', async () => {
    const f = await fixture()
    f.request.mockResolvedValue({ ...f.task, run_id: randomUUID() })
    await expect(f.facade.cancel(f.task.id, f.task.run_id)).rejects.toThrow('REVISION_CONFLICT')
    await expect(f.facade.artifact(f.task.id, f.task.run_id, 'artifact:test')).rejects.toThrow(
      'REVISION_CONFLICT'
    )
  })
  it.each(['id', 'run_id'])(
    'refuses to dispatch when binding returns another %s',
    async (field) => {
      const f = await fixture()
      f.request.mockResolvedValueOnce(f.task).mockResolvedValueOnce({
        ...f.task,
        [field]: randomUUID()
      })
      await expect(f.facade.create(f.input)).rejects.toThrow('REVISION_CONFLICT')
      expect(f.request).toHaveBeenCalledTimes(2)
    }
  )
  it('rejects malformed run identifiers before requesting a task', async () => {
    const f = await fixture()
    await expect(f.facade.cancel(f.task.id, 'not-a-run')).rejects.toThrow()
    await expect(f.facade.artifact(f.task.id, 'not-a-run', 'artifact:test')).rejects.toThrow()
    expect(f.request).not.toHaveBeenCalled()
  })
  it('reads a historical run artifact from its own committed receipt', async () => {
    const f = await fixture()
    const hash = (value: string) => createHash('sha256').update(value).digest('hex')
    const text = 'Historical run result'
    const artifactId = hash('historical-artifact')
    const artifactRef = `artifact:${artifactId}`
    const outcomeId = hash('historical-outcome')
    await mkdir(f.artifactDirectory)
    await writeFile(join(f.artifactDirectory, artifactId), text)
    await writeFile(
      join(f.artifactDirectory, `outcome-${outcomeId}.json`),
      JSON.stringify({
        status: 'succeeded',
        artifacts: [{ ref: artifactRef, name: 'report.md', digest: hash(text) }]
      })
    )
    const command = taskCommand()
    const receipt = {
      protocolVersion: 1,
      runtimeRecordId: command.runtimeRecordId,
      ownershipEpoch: command.ownershipEpoch,
      executionId: command.executionId,
      executionEpoch: command.executionEpoch,
      commandFingerprint: 'a'.repeat(64),
      recordedAt: '2026-10-06T00:00:00.000Z',
      kind: 'execution.result',
      receiptId: 'receipt:historical',
      outcomeRef: `outcome:${outcomeId}`,
      artifactRefs: [artifactRef],
      usageFactRefs: [],
      status: 'succeeded',
      stopProof: {
        proofRef: 'proof:historical',
        evidenceKind: 'stopped',
        managedToolsSettled: true,
        writersFenced: true,
        recordedAt: '2026-10-06T00:00:00.000Z'
      }
    }
    f.request.mockResolvedValue({ ...f.task, result_receipt: receipt })
    expect(await f.facade.artifact(f.task.id, f.task.run_id, artifactRef)).toEqual({
      name: 'report.md',
      text
    })
    expect(f.request).toHaveBeenCalledWith(
      `/hive/tasks/${f.task.id}/runs/${f.task.run_id}`,
      undefined
    )
  })
})
