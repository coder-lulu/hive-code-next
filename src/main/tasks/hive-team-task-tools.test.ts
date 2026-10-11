import { randomUUID } from 'node:crypto'
import { readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalAgentSessionDigest as digest } from '../../shared/agent-session-mutation-envelope'
import { createHiveTeamTaskToolFactory } from './hive-team-task-tools'
import { teamToolFixture } from './hive-team-task-tools.test-fixture'

const directories: string[] = []
const fixture = async () => {
  const f = await teamToolFixture()
  directories.push(f.directory)
  return f
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})
const ok = () => {}

describe('conversation team task bootstrap', () => {
  it('creates through the Case facade, starts its actual stage and projects bounded business status', async () => {
    const f = await fixture()
    expect(await f.status()).toEqual({ success: true, value: { state: 'no_record' } })
    const result = await f.invoke()
    expect(result).toMatchObject({
      success: true,
      value: { state: 'active', caseRef: f.view.id, runs: [{ status: 'pending' }] }
    })
    expect(f.create).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        ...f.argumentsValue,
        projectId: f.team.project.id,
        workflowId: f.workflow.workflowId,
        expectedProjectRevision: 2,
        workflowRevision: 3
      })
    )
    expect(f.start).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        caseId: f.view.id,
        stageRef: f.view.currentStageRef,
        expectedCaseRevision: 1,
        expectedTaskRevision: 0
      })
    )
    const files = await readdir(join(f.directory, 'conversation-tools'))
    const contents = await readFile(join(f.directory, 'conversation-tools', files[0]), 'utf8')
    expect(contents).not.toContain('do-not-persist-token')
    expect(contents).not.toContain(f.path)
    expect(JSON.stringify(result)).not.toContain('ownerDigest')
  })

  it.each([
    'companyId',
    'projectId',
    'workflowId',
    'workspaceSelector',
    'command',
    'env',
    'provider',
    'path'
  ])('rejects model-injected %s before any facade call', async (field) => {
    const f = await fixture()
    const result = await f.session.call(
      { ...f.call, arguments: { ...f.argumentsValue, [field]: 'injected' } },
      ok
    )
    expect(result).toMatchObject({ success: false, value: { code: 'INVALID_REQUEST' } })
    expect(f.listCompanies).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
  })

  it.each([
    { title: '', requirement: 'x' },
    { title: 'x', requirement: '' },
    { title: 'x'.repeat(241), requirement: 'x' },
    { title: 'x', requirement: 'x'.repeat(8193) }
  ])('rejects invalid payload bounds', async (argumentsValue) => {
    const f = await fixture()
    expect(await f.session.call({ ...f.call, arguments: argumentsValue }, ok)).toMatchObject({
      success: false,
      value: { code: 'INVALID_REQUEST' }
    })
    expect(f.create).not.toHaveBeenCalled()
  })

  it.each([
    'no-project',
    'multiple-projects',
    'no-workflow',
    'multiple-workflows',
    'company-page',
    'project-page',
    'workflow-page',
    'no-team',
    'workspace-mismatch'
  ])('refuses unavailable unique configuration: %s', async (kind) => {
    const f = await fixture()
    if (kind === 'no-project') {
      f.listProjects.mockResolvedValue({ items: [], nextCursor: null })
    }
    if (kind === 'multiple-projects') {
      f.listProjects.mockResolvedValue({
        items: [f.team.project, f.team.project],
        nextCursor: null
      })
    }
    if (kind === 'no-workflow') {
      f.listWorkflows.mockResolvedValue({ items: [], nextCursor: null })
    }
    if (kind === 'multiple-workflows') {
      f.listWorkflows.mockResolvedValue({ items: [f.workflow, f.workflow], nextCursor: null })
    }
    if (kind === 'company-page') {
      f.listCompanies.mockResolvedValue({ items: [f.team.company], nextCursor: randomUUID() })
    }
    if (kind === 'project-page') {
      f.listProjects.mockResolvedValue({ items: [f.team.project], nextCursor: randomUUID() })
    }
    if (kind === 'workflow-page') {
      f.listWorkflows.mockResolvedValue({ items: [f.workflow], nextCursor: randomUUID() })
    }
    if (kind === 'no-team') {
      f.team.employees = []
      f.team.executionAvailability.reason = 'TEAM_NOT_CONFIGURED'
    }
    if (kind === 'workspace-mismatch') {
      f.team.project.binding.hiveWorkspaceRef = 'workspace:elsewhere'
    }
    expect(await f.invoke()).toMatchObject({
      success: false,
      value: { code: 'CAPABILITY_UNAVAILABLE' }
    })
    expect(f.create).not.toHaveBeenCalled()
  })

  it('serializes concurrent duplicates including same-turn new call IDs and reconstructed factory', async () => {
    const f = await fixture()
    const results = await Promise.all([
      f.invoke(),
      f.invoke(),
      f.session.call({ ...f.call, callId: 'call-2' }, ok)
    ])
    expect(results.every((result) => result.success)).toBe(true)
    const session = createHiveTeamTaskToolFactory(f.options)(f.sessionInput)
    expect(await session.bindThread(f.threadId, true)).toBe(true)
    expect((await session.call({ ...f.call, callId: 'call-3' }, ok)).success).toBe(true)
    expect(f.create).toHaveBeenCalledTimes(1)
    expect(f.start).toHaveBeenCalledTimes(1)
  })

  it('rejects changed payload in same turn and reused call ID in another turn', async () => {
    const f = await fixture()
    await f.invoke()
    for (const call of [
      { ...f.call, arguments: { ...f.argumentsValue, title: 'Other task' } },
      { ...f.call, turnId: 'different-turn' }
    ]) {
      expect(await f.session.call(call, ok)).toMatchObject({
        success: false,
        value: { code: 'IDEMPOTENCY_CONFLICT' }
      })
    }
    expect(f.create).toHaveBeenCalledTimes(1)
    expect(f.start).toHaveBeenCalledTimes(1)
  })

  it('replays the original create UUID after lost response and factory reconstruction', async () => {
    const f = await fixture()
    const create = f.create.getMockImplementation()!
    f.create.mockImplementationOnce(async (input) => {
      await create(input)
      throw new Error('lost response')
    })
    expect(await f.invoke()).toMatchObject({ success: false })
    expect(await f.status()).toMatchObject({
      success: true,
      value: { state: 'creation_unconfirmed' }
    })
    const recovered = createHiveTeamTaskToolFactory(f.options)(f.sessionInput)
    await recovered.bindThread(f.threadId, true)
    expect((await recovered.call({ ...f.call, callId: 'call-recovery' }, ok)).success).toBe(true)
    expect(f.create.mock.calls[1][0]).toEqual(f.create.mock.calls[0][0])
    expect(f.start).toHaveBeenCalledTimes(1)
  })

  it.each([true, false])(
    'never repeats an uncertain start, even when admitted=%s',
    async (admitted) => {
      const f = await fixture()
      const start = f.start.getMockImplementation()!
      f.start.mockImplementationOnce(async (input) => {
        if (admitted) {
          await start(input)
        }
        throw new Error('response lost')
      })
      expect(await f.invoke()).toMatchObject({ success: false })
      const recovered = createHiveTeamTaskToolFactory(f.options)(f.sessionInput)
      await recovered.bindThread(f.threadId, true)
      expect(await recovered.call({ ...f.call, callId: 'another-call' }, ok)).toMatchObject({
        success: true,
        value: { state: admitted ? 'active' : 'start_unconfirmed' }
      })
      expect(f.create).toHaveBeenCalledTimes(1)
      expect(f.start).toHaveBeenCalledTimes(1)
    }
  )

  it.each([
    'account',
    'authority',
    'generation',
    'runtime',
    'epoch',
    'workspace',
    'host',
    'project',
    'workflow'
  ])('rejects %s drift during create await before start', async (kind) => {
    const f = await fixture()
    const create = f.create.getMockImplementation()!
    f.create.mockImplementationOnce(async (input) => {
      const result = await create(input)
      if (kind === 'account') {
        f.setAccount({ ...f.account(), accountId: 'other-account' })
      }
      if (kind === 'authority') {
        f.setAccount({ ...f.account(), authorityId: 'other-authority' })
      }
      if (kind === 'generation') {
        f.setAccount({ ...f.account(), sessionGeneration: 2 })
      }
      if (kind === 'runtime') {
        f.setRuntime({ ...f.runtime(), runtimeRecordId: randomUUID() })
      }
      if (kind === 'epoch') {
        f.setRuntime({ ...f.runtime(), ownershipEpoch: 2 })
      }
      if (kind === 'workspace') {
        f.invalidateWorkspace()
      }
      if (kind === 'host') {
        f.invalidate()
      }
      if (kind === 'project') {
        f.team.project.binding.bindingRevision++
      }
      if (kind === 'workflow') {
        f.workflow.definition.workflowRevision++
        f.workflow.definitionDigest = digest({
          name: f.workflow.name,
          definition: f.workflow.definition
        })
      }
      return result
    })
    expect(await f.invoke()).toMatchObject({ success: false })
    expect(f.start).not.toHaveBeenCalled()
  })

  it('checks the per-call cancellation guard after asynchronous create', async () => {
    const f = await fixture()
    let current = true
    const create = f.create.getMockImplementation()!
    f.create.mockImplementationOnce(async (input) => {
      const view = await create(input)
      current = false
      return view
    })
    expect(
      await f.session.call(f.call, () => {
        if (!current) {
          throw new Error('cancelled')
        }
      })
    ).toMatchObject({ success: false })
    expect(f.start).not.toHaveBeenCalled()
  })

  it('refuses foreign and sibling session Case references without reading them', async () => {
    const f = await fixture()
    await f.invoke()
    f.getCase.mockClear()
    expect(await f.status(randomUUID())).toMatchObject({
      success: false,
      value: { code: 'FORBIDDEN' }
    })
    const sibling = f.factory({ ...f.sessionInput, sessionId: randomUUID() })
    await sibling.bindThread(randomUUID(), false)
    expect(
      await sibling.call(
        {
          name: 'hive_team_task_status',
          arguments: { caseRef: f.view.id },
          callId: 'sibling',
          turnId: 'sibling'
        },
        ok
      )
    ).toMatchObject({ success: false, value: { code: 'FORBIDDEN' } })
    expect(f.getCase).not.toHaveBeenCalled()
  })

  it('refuses expired/missing credentials and changed owner after cold recovery', async () => {
    const f = await fixture()
    await f.invoke()
    f.setAccount({ ...f.account(), sessionGeneration: 2 })
    const recovered = createHiveTeamTaskToolFactory(f.options)(f.sessionInput)
    await recovered.bindThread(f.threadId, true)
    expect(
      await recovered.call(
        { name: 'hive_team_task_status', arguments: {}, callId: 'status', turnId: 'status' },
        ok
      )
    ).toMatchObject({ success: false, value: { code: 'REVISION_CONFLICT' } })
    f.setAccount(null)
    expect(await f.status()).toMatchObject({ success: false, value: { code: 'FORBIDDEN' } })
  })

  it('requires exact persisted thread catalog before calls; older chats cannot acquire it on resume', async () => {
    const f = await fixture()
    const absent = f.factory({ ...f.sessionInput, sessionId: randomUUID() })
    expect(await absent.bindThread(randomUUID(), true)).toBe(false)
    expect(await absent.call(f.call, ok)).toMatchObject({
      success: false,
      value: { code: 'FORBIDDEN' }
    })
    expect(await f.session.bindThread(randomUUID(), true)).toBe(false)
    expect(f.create).not.toHaveBeenCalled()
  })

  it('rejects corrupted receipts rather than resetting idempotency', async () => {
    const f = await fixture()
    await f.invoke()
    const root = join(f.directory, 'conversation-tools')
    const [name] = await readdir(root)
    const envelope = JSON.parse(await readFile(join(root, name), 'utf8'))
    envelope.receipt.operations[0].createInput.title = 'corrupt'
    await writeFile(join(root, name), JSON.stringify(envelope))
    expect(await f.invoke()).toMatchObject({ success: false })
    expect(f.create).toHaveBeenCalledTimes(1)
  })

  it.each([
    'create-response-lost',
    'start-response-lost',
    'unknown',
    'cancelRequested',
    'unrelated-start'
  ])('prevents a new turn from bypassing %s', async (kind) => {
    const f = await fixture()
    if (kind === 'create-response-lost') {
      f.create.mockRejectedValueOnce(new Error('create response lost'))
    }
    if (kind === 'start-response-lost') {
      f.start.mockRejectedValueOnce(new Error('start response lost'))
    }
    await f.invoke()
    if (kind === 'unknown' || kind === 'cancelRequested') {
      f.runs[0].status = kind
    }
    if (kind === 'unrelated-start') {
      f.runs[0].startRequest.requestId = randomUUID()
    }
    const originalRuns = structuredClone(f.runs)
    const originalView = structuredClone(f.view)
    const starts = f.start.mock.calls.length
    expect(
      await f.session.call(
        {
          ...f.call,
          turnId: 'new-turn',
          callId: 'new-call',
          arguments: { title: 'New goal', requirement: 'Execute another goal' }
        },
        ok
      )
    ).toMatchObject({ success: false, value: { code: 'OUTCOME_UNKNOWN' } })
    expect(f.create).toHaveBeenCalledTimes(1)
    expect(f.start).toHaveBeenCalledTimes(starts)
    expect(f.runs).toEqual(originalRuns)
    expect(f.view).toEqual(originalView)
  })

  it('permits a new distinct goal after status proves the lost start response was admitted', async () => {
    const f = await fixture()
    const start = f.start.getMockImplementation()!
    f.start.mockImplementationOnce(async (input) => {
      await start(input)
      throw new Error('response lost')
    })
    expect((await f.invoke()).success).toBe(false)
    expect(await f.status()).toMatchObject({ success: true, value: { state: 'active' } })
    const originalView = structuredClone(f.view)
    const originalRuns = structuredClone(f.runs)
    f.getCase.mockImplementation(async (query) =>
      query.caseId === originalView.id ? structuredClone(originalView) : structuredClone(f.view)
    )
    f.getRuns.mockImplementation(async (query) =>
      structuredClone(query.caseId === originalView.id ? originalRuns : f.runs)
    )
    const create = f.create.getMockImplementation()!
    f.create.mockImplementationOnce(async (input) => {
      const newId = randomUUID()
      f.view.id = newId
      f.view.binding.workflowRunRef = newId
      f.runs.splice(0)
      return create(input)
    })
    expect(
      await f.session.call(
        {
          ...f.call,
          turnId: 'new-turn',
          callId: 'new-call',
          arguments: { title: 'New goal', requirement: 'Execute a distinct goal' }
        },
        ok
      )
    ).toMatchObject({ success: true, value: { state: 'active' } })
    expect(f.create).toHaveBeenCalledTimes(2)
    expect(f.start).toHaveBeenCalledTimes(2)
    expect(f.start.mock.calls[0][0].requestId).not.toBe(f.start.mock.calls[1][0].requestId)
  })
})
