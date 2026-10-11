import { randomUUID } from 'node:crypto'
import { link, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalAgentSessionDigest as digest } from '../../shared/agent-session-mutation-envelope'
import { createHiveTeamTaskToolFactory } from './hive-team-task-tools'
import { teamToolReceiptStore } from './hive-team-task-tools-receipts'
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

describe('team tool durable receipt boundaries', () => {
  it('rebinds a positively superseded unsaved empty thread using the exact prior catalog', async () => {
    const f = await fixture()
    const replacement = randomUUID()
    expect(await f.session.bindThread(replacement, false, f.threadId)).toBe(true)
    const recovered = createHiveTeamTaskToolFactory(f.options)(f.sessionInput)
    expect(await recovered.bindThread(replacement, true)).toBe(true)
    expect(await recovered.call(f.call, ok)).toMatchObject({ success: true })
    expect(f.create).toHaveBeenCalledTimes(1)
  })

  it.each([
    'missing-proof',
    'wrong-prior',
    'existing-operation',
    'resume',
    'same-thread',
    'catalog-drift'
  ])('refuses unsafe catalog replacement: %s', async (kind) => {
    const f = await fixture()
    if (kind === 'existing-operation') {
      await f.invoke()
    }
    if (kind === 'catalog-drift') {
      const store = teamToolReceiptStore(f.directory, f.sessionInput.sessionId)
      const receipt = await store.read()
      receipt.catalog!.catalogDigest = 'f'.repeat(64)
      await store.write(receipt, ok)
    }
    const newId = kind === 'same-thread' ? f.threadId : randomUUID()
    const proof =
      kind === 'missing-proof' ? undefined : kind === 'wrong-prior' ? randomUUID() : f.threadId
    expect(await f.session.bindThread(newId, kind === 'resume', proof)).toBe(false)
    expect(await f.session.call(f.call, ok)).toMatchObject({
      success: false,
      value: { code: 'FORBIDDEN' }
    })
    expect(f.create).toHaveBeenCalledTimes(kind === 'existing-operation' ? 1 : 0)
  })

  it('coordinates separate factories for one session during a delayed create', async () => {
    const f = await fixture()
    const second = createHiveTeamTaskToolFactory(f.options)(f.sessionInput)
    await second.bindThread(f.threadId, true)
    let release!: () => void
    let admitted!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const entered = new Promise<void>((resolve) => {
      admitted = resolve
    })
    const create = f.create.getMockImplementation()!
    f.create.mockImplementationOnce(async (input) => {
      admitted()
      await blocked
      return create(input)
    })
    const first = f.invoke()
    await entered
    const replay = second.call({ ...f.call, callId: 'second-factory' }, ok)
    release()
    expect((await Promise.all([first, replay])).every((result) => result.success)).toBe(true)
    expect(f.create).toHaveBeenCalledTimes(1)
    expect(f.start).toHaveBeenCalledTimes(1)
  })

  it('refuses more than 32 starts per session and 32 alternate call IDs per turn', async () => {
    const f = await fixture()
    await f.invoke()
    const store = teamToolReceiptStore(f.directory, f.sessionInput.sessionId)
    const receipt = await store.read()
    const original = receipt.operations[0]
    original.callIds = Array.from({ length: 32 }, (_, index) => `call-${index + 1}`)
    await store.write(receipt, ok)
    expect(await f.session.call({ ...f.call, callId: 'overflow-call' }, ok)).toMatchObject({
      success: false,
      value: { code: 'CAPACITY_EXCEEDED' }
    })
    original.callIds = ['call-1']
    receipt.operations = Array.from({ length: 32 }, (_, index) => ({
      ...structuredClone(original),
      turnId: `turn-${index + 1}`,
      callIds: [`call-${index + 1}`],
      createInput: { ...original.createInput, requestId: randomUUID() }
    }))
    await store.write(receipt, ok)
    expect(
      await f.session.call({ ...f.call, callId: 'new-call', turnId: 'new-turn' }, ok)
    ).toMatchObject({ success: false, value: { code: 'CAPACITY_EXCEEDED' } })
    expect(f.create).toHaveBeenCalledTimes(1)
    expect(f.start).toHaveBeenCalledTimes(1)
  })

  it('refuses an oversized receipt without resetting the original operation', async () => {
    const f = await fixture()
    const root = join(f.directory, 'conversation-tools')
    const [name] = await readdir(root)
    await writeFile(join(root, name), ' '.repeat(2 * 1024 * 1024 + 1))
    expect(await f.invoke()).toMatchObject({ success: false })
    expect(f.create).not.toHaveBeenCalled()
  })

  it('refuses hardlinked receipts', async () => {
    const f = await fixture()
    const root = join(f.directory, 'conversation-tools')
    const [name] = await readdir(root)
    await link(join(root, name), join(f.directory, 'receipt-link'))
    expect(await f.invoke()).toMatchObject({ success: false, value: { code: 'FORBIDDEN' } })
    expect(f.create).not.toHaveBeenCalled()
  })

  it('refuses a symlink/junction receipt directory', async () => {
    const f = await fixture()
    const root = join(f.directory, 'conversation-tools')
    const target = join(f.directory, 'moved-receipts')
    await rename(root, target)
    await symlink(target, root, process.platform === 'win32' ? 'junction' : 'dir')
    expect(await f.invoke()).toMatchObject({ success: false, value: { code: 'FORBIDDEN' } })
    expect(f.create).not.toHaveBeenCalled()
  })

  it('validates payload and scope bindings even when the envelope digest is recomputed', async () => {
    const f = await fixture()
    await f.invoke()
    const root = join(f.directory, 'conversation-tools')
    const [name] = await readdir(root)
    const envelope = JSON.parse(await readFile(join(root, name), 'utf8'))
    envelope.receipt.operations[0].createInput.projectId = randomUUID()
    envelope.digest = digest(envelope.receipt)
    await writeFile(join(root, name), JSON.stringify(envelope))
    expect(await f.invoke()).toMatchObject({ success: false })
    expect(f.create).toHaveBeenCalledTimes(1)
  })

  it('refuses foreign Case views and run identities from the facade', async () => {
    const f = await fixture()
    const create = f.create.getMockImplementation()!
    f.create.mockImplementationOnce(async (input) => {
      const view = await create(input)
      view.team.project.hiveWorkspaceRef = 'workspace:foreign'
      return view
    })
    expect(await f.invoke()).toMatchObject({ success: false, value: { code: 'REVISION_CONFLICT' } })
    expect(f.start).not.toHaveBeenCalled()
    expect((await f.invoke()).success).toBe(true)
    f.runs[0].task.taskId = randomUUID()
    expect(await f.status()).toMatchObject({ success: false, value: { code: 'REVISION_CONFLICT' } })
  })

  it('does not expose provider or credential error messages', async () => {
    const f = await fixture()
    f.create.mockRejectedValue(new Error('access_token=private-provider-secret'))
    const result = await f.invoke()
    expect(result).toMatchObject({ success: false, value: { code: 'SERVICE_UNAVAILABLE' } })
    expect(JSON.stringify(result)).not.toContain('private-provider-secret')
  })

  it('bounds directory enumeration for 31 authenticated historical Case reads', async () => {
    const f = await fixture()
    await f.invoke()
    const store = teamToolReceiptStore(f.directory, f.sessionInput.sessionId)
    const receipt = await store.read()
    const original = receipt.operations[0]
    const views = new Map<string, typeof f.view>()
    const runs = new Map<string, typeof f.runs>()
    receipt.operations = Array.from({ length: 31 }, (_, index) => {
      const operation = structuredClone(original)
      const view = structuredClone(f.view)
      const caseRef = randomUUID()
      operation.turnId = `history-turn-${index}`
      operation.callIds = [`history-call-${index}`]
      operation.createInput.requestId = randomUUID()
      operation.caseRef = caseRef
      operation.startInput!.caseId = caseRef
      operation.startInput!.requestId = randomUUID()
      view.id = caseRef
      view.binding.workflowRunRef = caseRef
      view.originTaskId = randomUUID()
      view.stageTasks.forEach((task) => {
        task.taskId = randomUUID()
      })
      const run = structuredClone(f.runs[0])
      run.caseId = caseRef
      run.startRequest = operation.startInput!
      run.task.taskId = view.stageTasks.find((task) => task.stageRef === run.stageRef)!.taskId
      run.task.runId = randomUUID()
      views.set(caseRef, view)
      runs.set(caseRef, [run])
      return operation
    })
    await store.write(receipt, ok)
    f.getCase.mockImplementation(async (query) =>
      structuredClone(views.get(query.caseId) ?? f.view)
    )
    f.getRuns.mockImplementation(async (query) => structuredClone(runs.get(query.caseId) ?? f.runs))
    const create = f.create.getMockImplementation()!
    f.create.mockImplementationOnce(async (input) => {
      f.view.id = randomUUID()
      f.view.binding.workflowRunRef = f.view.id
      f.runs.splice(0)
      return create(input)
    })
    f.listCompanies.mockClear()
    f.getCase.mockClear()
    expect(
      await f.session.call({ ...f.call, turnId: 'new-goal', callId: 'new-goal' }, ok)
    ).toMatchObject({ success: true })
    expect(f.getCase).toHaveBeenCalledTimes(32)
    expect(f.listCompanies.mock.calls.length).toBeLessThanOrEqual(8)
    expect(f.create).toHaveBeenCalledTimes(2)
  })

  it.each(['workflow', 'workspace'])(
    'refuses %s drift while inspecting history before a new goal',
    async (kind) => {
      const f = await fixture()
      await f.invoke()
      f.getRuns.mockImplementationOnce(async () => {
        if (kind === 'workflow') {
          f.workflow.definition.workflowRevision++
          f.workflow.definitionDigest = digest({
            name: f.workflow.name,
            definition: f.workflow.definition
          })
        } else {
          f.team.project.binding.hiveWorkspaceRef = 'workspace:detached'
        }
        return structuredClone(f.runs)
      })
      expect(
        await f.session.call({ ...f.call, turnId: 'new-goal', callId: 'new-goal' }, ok)
      ).toMatchObject({ success: false })
      expect(f.create).toHaveBeenCalledTimes(1)
      expect(f.start).toHaveBeenCalledTimes(1)
    }
  )
})
