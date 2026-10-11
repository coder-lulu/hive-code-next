import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { vi } from 'vitest'
import type { HiveTasksApi } from '../../shared/hive-tasks'
import type {
  HiveWorkflowCaseRun,
  HiveWorkflowCaseStart,
  HiveWorkflowCaseRunsApi
} from '../../shared/hive-workflow-case-runs'
import type { HiveWorkflowCasesApi } from '../../shared/hive-workflow-cases'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-publication'
import { workflowCaseFixture } from '../../shared/hive-workflow-cases.test-fixture'
import { createHiveTeamTaskToolFactory } from './hive-team-task-tools'
import { teamToolHash } from './hive-team-task-tools-scope'
import type { HiveTeamTaskToolOptions } from './hive-team-task-tool-ports'
import type { LocalTaskRuntimeOwner } from './local-task-binding-options'

export async function teamToolFixture() {
  const root = resolve('logs/paperclip-development/20261011-task-tools/tmp')
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'tools-'))
  const data = workflowCaseFixture()
  const path = resolve(directory, 'source')
  const workspaceRef = `workspace:${teamToolHash(path)}`
  data.team.project.binding.hiveWorkspaceRef = workspaceRef
  data.view.team.project.hiveWorkspaceRef = workspaceRef
  let account: HiveRuntimeCloudAuthorization | null = {
    accountId: 'workflow-case-owner',
    authorityId: 'authority:test',
    accessToken: 'do-not-persist-token',
    sessionGeneration: 1,
    sessionExpiresAt: Date.now() + 600_000
  }
  let runtime: LocalTaskRuntimeOwner | null = {
    accountId: account.accountId,
    runtimeRecordId: randomUUID(),
    ownershipEpoch: 1
  }
  let current = true
  let workspaceCurrent = true
  const guard = () => {
    if (!current) {
      throw Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' })
    }
  }
  const runs: HiveWorkflowCaseRun[] = []
  const create = vi.fn<HiveWorkflowCasesApi['createWorkflowCase']>(async (input) => {
    data.view.title = input.title
    data.view.requirement = input.requirement
    return structuredClone(data.view)
  })
  const start = vi.fn<HiveWorkflowCaseRunsApi['startWorkflowCase']>(
    async (input: HiveWorkflowCaseStart) => {
      const task = data.view.stageTasks.find((task) => task.stageRef === input.stageRef)!
      const run: HiveWorkflowCaseRun = {
        caseId: data.view.id,
        stageRef: task.stageRef,
        role: task.role,
        employeeRef: task.employeeRef,
        startRequest: input,
        task: {
          spaceId: data.team.company.id,
          taskId: task.taskId,
          runId: randomUUID(),
          taskRevision: String(input.expectedTaskRevision + 1),
          attempt: 1
        },
        title: data.view.title,
        status: 'pending',
        artifactRefs: []
      }
      runs.push(run)
      return run
    }
  )
  const listCompanies = vi.fn<HiveTasksApi['listCompanies']>(async () => ({
    items: [data.team.company],
    nextCursor: null
  }))
  const listProjects = vi.fn<HiveTasksApi['listProjects']>(async () => ({
    items: [data.team.project],
    nextCursor: null
  }))
  const listWorkflows = vi.fn<HiveTasksApi['listWorkflows']>(async () => ({
    items: [data.workflow],
    nextCursor: null
  }))
  const getTeam = vi.fn(async () => structuredClone(data.team))
  const getCase = vi.fn<HiveWorkflowCasesApi['getWorkflowCase']>(async () =>
    structuredClone(data.view)
  )
  const getRuns = vi.fn<HiveWorkflowCaseRunsApi['getWorkflowCaseRuns']>(async () =>
    structuredClone(runs)
  )
  const facade = {
    listCompanies,
    listProjects,
    listWorkflows,
    getTeam,
    createWorkflowCase: create,
    startWorkflowCase: start,
    getWorkflowCase: getCase,
    getWorkflowCaseRuns: getRuns
  } satisfies HiveTeamTaskToolOptions['facade']
  const options: HiveTeamTaskToolOptions = {
    facade,
    directory,
    assertCurrent: guard,
    currentAccount: () => account,
    currentRuntime: () => runtime,
    resolveWorkspaceSource: async () => ({
      path,
      assertCurrent: () => {
        if (!workspaceCurrent) {
          throw Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' })
        }
      }
    })
  }
  const sessionInput = {
    sessionId: randomUUID(),
    workspaceSelector: 'id:workspace-test',
    assertCurrent: guard
  }
  const factory = createHiveTeamTaskToolFactory(options)
  const session = factory(sessionInput)
  const threadId = randomUUID()
  await session.bindThread(threadId, false)
  const argumentsValue = {
    title: 'Test team task',
    requirement: 'Implement the feature and verify it independently.'
  }
  const call = {
    name: 'hive_team_task_start',
    arguments: argumentsValue,
    callId: 'call-1',
    turnId: 'turn-1'
  }
  return {
    ...data,
    path,
    directory,
    options,
    factory,
    session,
    sessionInput,
    threadId,
    call,
    argumentsValue,
    create,
    start,
    listCompanies,
    listProjects,
    listWorkflows,
    getTeam,
    getCase,
    getRuns,
    runs,
    account: () => account!,
    runtime: () => runtime!,
    setAccount: (next: typeof account) => {
      account = next
    },
    setRuntime: (next: typeof runtime) => {
      runtime = next
    },
    invalidate: () => {
      current = false
    },
    invalidateWorkspace: () => {
      workspaceCurrent = false
    },
    invoke: () => session.call(call, guard),
    status: (caseRef?: string) =>
      session.call(
        {
          name: 'hive_team_task_status',
          arguments: caseRef ? { caseRef } : {},
          callId: 'status-1',
          turnId: 'status-turn'
        },
        guard
      )
  }
}
