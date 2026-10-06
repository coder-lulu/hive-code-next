import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-publication'
import { canonicalAgentSessionDigest } from '../../shared/agent-session-mutation-envelope'
import type { HiveWorkbenchTeam } from '../../shared/hive-team-workbench'
import {
  HiveWorkflowSaveSchema,
  HiveWorkflowPageSchema,
  HiveWorkflowSnapshotSchema
} from '../../shared/hive-task-workflows'
import { workflowTestVectors } from '../../shared/task-workflow/workflow.test-fixture'
import { createHiveTaskFacade } from './hive-task-facade'
import { TaskArtifactIndex } from './task-artifact-index'
import { createLocalTaskRequest, type LocalTaskClientOptions } from './local-task-http-client'

let directory: string
beforeEach(async () => {
  const root = resolve('logs/paperclip-development/p3/workflow-facade/tmp')
  await mkdir(root, { recursive: true })
  directory = await mkdtemp(join(root, 'facade-'))
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

async function fixture(useHttpClient = false) {
  let account: HiveRuntimeCloudAuthorization | null = {
    accountId: 'workflow-owner',
    authorityId: 'authority:workflow',
    accessToken: 'test-token',
    sessionGeneration: 1,
    sessionExpiresAt: Date.now() + 60_000
  }
  const owner = createHash('sha256').update(JSON.stringify(account.accountId)).digest('hex')
  const companyId: string = randomUUID()
  const projectId: string = randomUUID()
  const team: HiveWorkbenchTeam = {
    company: {
      id: companyId,
      name: 'Company',
      binding: {
        contractVersion: 1,
        kind: 'workflow.company-binding',
        companyRef: companyId,
        ownerScope: { kind: 'personalTenant', tenantRef: `account:${owner}` },
        ownerAccountRef: `account:${owner}`,
        ownerActorRef: `actor:${owner}`,
        bindingRevision: 1
      }
    },
    project: {
      id: projectId,
      companyId,
      name: 'Project',
      workspaceSelector: 'folder:source',
      binding: {
        contractVersion: 1,
        kind: 'workflow.project-binding',
        scope: { companyRef: companyId, projectRef: projectId },
        hiveWorkspaceRef: 'workspace:verified',
        bindingRevision: 2
      }
    },
    employees: [],
    executionAvailability: { available: false, reason: 'TEAM_NOT_CONFIGURED' }
  }
  const definition = {
    ...structuredClone(workflowTestVectors.examples.definition),
    scope: { companyRef: companyId, projectRef: projectId },
    workflowRef: randomUUID(),
    workflowRevision: 3
  }
  const snapshot = {
    workflowId: definition.workflowRef,
    name: 'Feature workflow',
    definition,
    definitionDigest: canonicalAgentSessionDigest({ name: 'Feature workflow', definition }),
    projectBindingRevision: 2
  }
  const refreshDigest = () => {
    snapshot.definitionDigest = canonicalAgentSessionDigest({ name: snapshot.name, definition })
  }
  const save = {
    requestId: randomUUID(),
    projectId,
    workflowId: snapshot.workflowId,
    expectedRevision: 2,
    expectedProjectRevision: 2,
    name: snapshot.name,
    stages: structuredClone(definition.stages),
    maxParallelism: definition.maxParallelism,
    maxDurationMs: definition.maxDurationMs
  }
  const read = { projectId, workflowId: snapshot.workflowId, revision: 3 }
  const request = vi.fn(async (path: string, _body?: unknown): Promise<unknown> => {
    if (path === '/hive/workbench/team/read') {
      return team
    }
    if (path === '/hive/workbench/workflows/list') {
      return { items: [snapshot], nextCursor: null }
    }
    return snapshot
  })
  const requestFactory = vi.fn((configuration: LocalTaskClientOptions) =>
    useHttpClient
      ? createLocalTaskRequest({
          ...configuration,
          fetch: async (url, init) =>
            new Response(
              JSON.stringify(
                await request(
                  new URL(url instanceof Request ? url.url : url).pathname,
                  typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
                )
              )
            )
        })
      : request
  )
  const assertCurrent = vi.fn()
  let workspaceCurrent = true
  const validateWorkspace = vi.fn(async (_selector: string) => ({
    workspaceRef: 'workspace:verified',
    assertCurrent: () => {
      if (!workspaceCurrent) {
        throw new Error('FORBIDDEN')
      }
    }
  }))
  const descriptorPath = join(directory, 'paperclip.json')
  await writeFile(
    descriptorPath,
    JSON.stringify({ baseUrl: 'http://127.0.0.1:1234', secret: 'x'.repeat(43) })
  )
  const { facade } = createHiveTaskFacade({
    descriptorPath,
    artifacts: new TaskArtifactIndex(join(directory, 'artifacts')),
    issuer: { issue: vi.fn() },
    currentAccount: () => account,
    assertCurrent,
    validateWorkspace,
    request: requestFactory
  })
  return {
    facade,
    snapshot,
    save,
    read,
    team,
    request,
    requestFactory,
    assertCurrent,
    validateWorkspace,
    refreshDigest,
    changeAccount: () => {
      if (account) {
        account = { ...account, sessionGeneration: 2 }
      }
    },
    signOut: () => {
      account = null
    },
    replaceWorkspace: () => {
      workspaceCurrent = false
    }
  }
}

describe('authenticated workflow facade', () => {
  it('recovers an immutable saved workflow request after a newer team binding', async () => {
    const f = await fixture()
    f.team.project.binding.bindingRevision += 1
    expect(await f.facade.saveWorkflow(f.save)).toEqual(f.snapshot)
    expect(f.validateWorkspace).toHaveBeenCalledWith(f.team.project.workspaceSelector)
    expect(f.request.mock.calls.at(-1)).toEqual(['/hive/workbench/workflows/save', f.save])
  })
  it.each(['list', 'read', 'save'] as const)(
    'keeps UUID identity and definition digests consistent for %s input aliases',
    async (operation) => {
      const f = await fixture()
      const digest = f.snapshot.definitionDigest
      const result =
        operation === 'list'
          ? await f.facade.listWorkflows({ projectId: f.read.projectId.toUpperCase() })
          : operation === 'read'
            ? await f.facade.getWorkflow({
                ...f.read,
                projectId: f.read.projectId.toUpperCase(),
                workflowId: f.read.workflowId.toUpperCase()
              })
            : await f.facade.saveWorkflow({
                ...f.save,
                requestId: f.save.requestId.toUpperCase(),
                projectId: f.save.projectId.toUpperCase(),
                workflowId: f.save.workflowId.toUpperCase()
              })
      expect(result).toEqual(
        operation === 'list' ? { items: [f.snapshot], nextCursor: null } : f.snapshot
      )
      expect(f.request.mock.calls.at(-1)?.[1]).toMatchObject({ projectId: f.read.projectId })
      if (operation === 'save') {
        expect(f.request.mock.calls.at(-1)?.[1]).toEqual(f.save)
      }
      expect(f.snapshot.definitionDigest).toBe(digest)
    }
  )
  it('reads a valid dense 50-workflow page through the authenticated HTTP client', async () => {
    const f = await fixture(true)
    const stages = Array.from({ length: 32 }, (_, index) => {
      const template = f.snapshot.definition.stages[index % 4]
      if (!template) {
        throw new Error('Missing workflow role fixture')
      }
      const { returnToStageRef: _return, ...stage } = template
      return {
        ...stage,
        stageRef: `s${index}`,
        dependsOn: Array.from({ length: index }, (_, previous) => `s${previous}`),
        acceptanceCriteria: ['ok'],
        ...(stage.role === 'tester' ? { returnToStageRef: `s${index - 1}` } : {})
      }
    })
    const page = HiveWorkflowPageSchema.parse({
      items: Array.from({ length: 50 }, () => {
        const workflowId = randomUUID()
        const definition = { ...f.snapshot.definition, workflowRef: workflowId, stages }
        return {
          ...f.snapshot,
          workflowId,
          definition,
          definitionDigest: canonicalAgentSessionDigest({ name: f.snapshot.name, definition })
        }
      }),
      nextCursor: null
    })
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(384 * 1024)
    f.request.mockImplementation(async (path) =>
      path === '/hive/workbench/team/read' ? f.team : page
    )
    await expect(
      f.facade.listWorkflows({ projectId: f.read.projectId, limit: 50 })
    ).resolves.toEqual(page)
  })

  it('uses the existing authenticated project mapping and bounded workflow routes', async () => {
    const f = await fixture()
    expect(await f.facade.listWorkflows({ projectId: f.read.projectId })).toEqual({
      items: [f.snapshot],
      nextCursor: null
    })
    expect(await f.facade.getWorkflow(f.read)).toEqual(f.snapshot)
    expect(await f.facade.saveWorkflow(f.save)).toEqual(f.snapshot)
    expect(f.request).toHaveBeenCalledWith('/hive/workbench/workflows/list', {
      projectId: f.read.projectId,
      limit: 25
    })
    expect(f.request).toHaveBeenCalledWith('/hive/workbench/workflows/read', f.read)
    expect(f.request).toHaveBeenCalledWith('/hive/workbench/workflows/save', f.save)
    expect(f.validateWorkspace).toHaveBeenCalledWith(f.team.project.workspaceSelector)
    expect(f.requestFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { 'X-Hive-Account-Id': 'workflow-owner' }
      })
    )
  })

  it('accepts creation only at revision zero and verifies the new revision and trimmed name', async () => {
    const f = await fixture()
    const { workflowId: _workflowId, ...create } = f.save
    f.snapshot.definition.workflowRevision = 1
    f.refreshDigest()
    expect(
      await f.facade.saveWorkflow({ ...create, expectedRevision: 0, name: ` ${create.name} ` })
    ).toEqual(f.snapshot)
    expect(f.request).toHaveBeenCalledWith('/hive/workbench/workflows/save', {
      ...create,
      expectedRevision: 0
    })
  })

  it.each(['list', 'read', 'save'] as const)(
    'rejects malformed %s requests before context access',
    async (method) => {
      const f = await fixture()
      const value =
        method === 'list'
          ? f.facade.listWorkflows({ projectId: 'not-a-uuid' })
          : method === 'read'
            ? f.facade.getWorkflow({ ...f.read, revision: 0 })
            : f.facade.saveWorkflow({ ...f.save, expectedRevision: 0 })
      await expect(value).rejects.toThrow()
      expect(f.assertCurrent).not.toHaveBeenCalled()
      expect(f.requestFactory).not.toHaveBeenCalled()
    }
  )

  it.each(['companyId', 'workspaceSelector', 'credentials', 'command'])(
    'rejects injected %s fields before context access',
    async (field) => {
      const f = await fixture()
      await expect(f.facade.saveWorkflow({ ...f.save, [field]: 'forged' })).rejects.toThrow()
      expect(f.assertCurrent).not.toHaveBeenCalled()
    }
  )

  it('keeps graph semantic admission on the authenticated service', async () => {
    const f = await fixture()
    const malformed = structuredClone(f.save)
    malformed.stages[2].returnToStageRef = 'stage:unknown'
    expect(HiveWorkflowSaveSchema.safeParse(malformed).success).toBe(true)
    f.request.mockImplementation(async (path) => {
      if (path === '/hive/workbench/team/read') {
        return f.team
      }
      throw new Error('INVALID_REQUEST')
    })
    await expect(f.facade.saveWorkflow(malformed)).rejects.toThrow('INVALID_REQUEST')
    expect(f.request).toHaveBeenCalledWith('/hive/workbench/workflows/save', malformed)
  })

  it.each(['companyRef', 'projectRef'] as const)(
    'rejects substituted %s projections',
    async (field) => {
      const f = await fixture()
      f.snapshot.definition.scope[field] = randomUUID()
      f.refreshDigest()
      await expect(f.facade.getWorkflow(f.read)).rejects.toThrow('REVISION_CONFLICT')
      await expect(f.facade.listWorkflows({ projectId: f.read.projectId })).rejects.toThrow(
        'REVISION_CONFLICT'
      )
    }
  )

  it('rejects a workflow or requested historical revision being substituted', async () => {
    const f = await fixture()
    await expect(f.facade.getWorkflow({ ...f.read, workflowId: randomUUID() })).rejects.toThrow(
      'REVISION_CONFLICT'
    )
    await expect(f.facade.getWorkflow({ ...f.read, revision: 2 })).rejects.toThrow(
      'REVISION_CONFLICT'
    )
    expect(
      await f.facade.getWorkflow({ projectId: f.read.projectId, workflowId: f.read.workflowId })
    ).toEqual(f.snapshot)
  })

  it('rejects wrong digests and non-UUID persisted scopes', async () => {
    const f = await fixture()
    f.snapshot.definitionDigest = 'a'.repeat(64)
    await expect(f.facade.getWorkflow(f.read)).rejects.toThrow(
      'workflow_definition_digest_mismatch'
    )
    f.snapshot.definition.scope.companyRef = 'company:forged'
    f.refreshDigest()
    expect(HiveWorkflowSnapshotSchema.safeParse(f.snapshot).success).toBe(false)
  })

  it.each(['workflow', 'project', 'name', 'stages', 'parallelism', 'duration'] as const)(
    'rejects substituted save %s receipts even with valid digests',
    async (field) => {
      const f = await fixture()
      if (field === 'workflow') {
        f.snapshot.definition.workflowRevision++
      }
      if (field === 'project') {
        f.snapshot.projectBindingRevision++
      }
      if (field === 'name') {
        f.snapshot.name = 'Another definition'
      }
      if (field === 'stages') {
        f.snapshot.definition.stages[0].acceptanceCriteria = ['Changed criterion']
      }
      if (field === 'parallelism') {
        f.snapshot.definition.maxParallelism = 2
      }
      if (field === 'duration') {
        f.snapshot.definition.maxDurationMs++
      }
      f.refreshDigest()
      await expect(f.facade.saveWorkflow(f.save)).rejects.toThrow('REVISION_CONFLICT')
    }
  )

  it('delegates stale admission CAS to the service and refuses mismatched workspace proofs before a write', async () => {
    const f = await fixture()
    const request = f.request.getMockImplementation()!
    f.request.mockImplementation(async (path, body) => {
      if (path === '/hive/workbench/workflows/save') {
        throw new Error('REVISION_CONFLICT')
      }
      return request(path, body)
    })
    await expect(f.facade.saveWorkflow({ ...f.save, expectedProjectRevision: 1 })).rejects.toThrow(
      'REVISION_CONFLICT'
    )
    expect(f.validateWorkspace).toHaveBeenCalledTimes(1)
    expect(f.request.mock.calls.at(-1)?.[0]).toBe('/hive/workbench/workflows/save')
    f.request.mockClear()
    f.team.project.binding.hiveWorkspaceRef = 'workspace:elsewhere'
    await expect(f.facade.saveWorkflow(f.save)).rejects.toThrow('REVISION_CONFLICT')
    expect(f.request.mock.calls.every(([path]) => path === '/hive/workbench/team/read')).toBe(true)
  })

  it('rejects a project owner mismatch before requesting workflow data', async () => {
    const f = await fixture()
    f.team.company.binding.ownerAccountRef = 'account:elsewhere'
    await expect(f.facade.getWorkflow(f.read)).rejects.toThrow('FORBIDDEN')
    expect(f.request).toHaveBeenCalledTimes(1)
  })

  it('rejects account changes while the workspace proof is pending before writing', async () => {
    const f = await fixture()
    f.validateWorkspace.mockImplementation(async () => {
      f.changeAccount()
      return { workspaceRef: 'workspace:verified', assertCurrent: () => undefined }
    })
    await expect(f.facade.saveWorkflow(f.save)).rejects.toThrow('FORBIDDEN')
    expect(f.request).toHaveBeenCalledTimes(1)
  })

  it.each(['account', 'workspace'] as const)(
    'rejects %s changes during delayed saves',
    async (change) => {
      const f = await fixture()
      let release: (() => void) | undefined
      let entered: (() => void) | undefined
      const pending = new Promise<void>((resolveEntered) => {
        entered = resolveEntered
      })
      f.request.mockImplementation(async (path) => {
        if (path === '/hive/workbench/team/read') {
          return f.team
        }
        await new Promise<void>((resolveReply) => {
          release = resolveReply
          entered?.()
        })
        return f.snapshot
      })
      const result = f.facade.saveWorkflow(f.save)
      const rejected = expect(result).rejects.toThrow('FORBIDDEN')
      await pending
      if (change === 'account') {
        f.changeAccount()
      } else {
        f.replaceWorkspace()
      }
      release?.()
      await rejected
    }
  )

  it('rejects signed-out reads and changed accounts during workflow responses', async () => {
    const f = await fixture()
    f.request.mockImplementation(async (path) => {
      if (path === '/hive/workbench/team/read') {
        return f.team
      }
      f.signOut()
      return f.snapshot
    })
    await expect(f.facade.getWorkflow(f.read)).rejects.toThrow('FORBIDDEN')
    await expect(f.facade.listWorkflows({ projectId: f.read.projectId })).rejects.toThrow(
      'FORBIDDEN'
    )
  })

  it('enforces the requested page size and rejects unknown response fields', async () => {
    const f = await fixture()
    f.request.mockImplementation(async (path) =>
      path === '/hive/workbench/team/read'
        ? f.team
        : { items: [f.snapshot, f.snapshot], nextCursor: null }
    )
    await expect(f.facade.listWorkflows({ projectId: f.read.projectId, limit: 1 })).rejects.toThrow(
      'REVISION_CONFLICT'
    )
    expect(HiveWorkflowSnapshotSchema.safeParse({ ...f.snapshot, command: 'forged' }).success).toBe(
      false
    )
  })
})
