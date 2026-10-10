import { build } from 'esbuild'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { beforeAll, describe, expect, it } from 'vitest'
import { canonicalAgentSessionDigest } from '../../src/shared/agent-session-mutation-envelope.ts'
import { workflowCaseFixture } from '../../src/shared/hive-workflow-cases.test-fixture.ts'
import { workflowCaseEvidenceFixture } from '../../src/renderer/src/components/task-page/hive/hive-workflow-case-evidence.test-fixtures.ts'
import { workflowTestVectors } from '../../src/shared/task-workflow/workflow.test-fixture.ts'
import { workflowPlanDraftFixture } from '../../src/shared/task-workflow/workflow-plan-draft.test-fixture.ts'
import { inspectWorkflowPlanProposal } from '../../src/shared/task-workflow/workflow-plan-validation.ts'

let contract
let caseContract
let sessionContract

beforeAll(async () => {
  const bundles = await Promise.all(
    ['hive-task-workflows', 'hive-workflow-cases', 'hive-workflow-case-session'].map((module) =>
      build({
        entryPoints: [resolve(`src/shared/${module}.ts`)],
        bundle: true,
        platform: 'browser',
        format: 'iife',
        globalName: 'HiveWorkflowContract',
        write: false,
        logLevel: 'silent'
      })
    )
  )
  ;[contract, caseContract, sessionContract] = bundles.map((bundle) =>
    runInNewContext(`${bundle.outputFiles[0].text}; HiveWorkflowContract`, { TextEncoder })
  )
})

function snapshot() {
  const definition = {
    ...structuredClone(workflowTestVectors.examples.definition),
    scope: { companyRef: randomUUID(), projectRef: randomUUID() },
    workflowRef: randomUUID()
  }
  const name = '功能流程 · é 🐝'
  return {
    workflowId: definition.workflowRef,
    name,
    definition,
    definitionDigest: canonicalAgentSessionDigest({ name, definition }),
    projectBindingRevision: 1
  }
}

describe('browser workflow contract', () => {
  it.each(['validated', 'rejected', 'unavailable'])(
    'validates a Case with an original %s draft without Node globals',
    (kind) => {
      const { view } = workflowCaseFixture()
      const draft = workflowPlanDraftFixture()
      const task = view.stageTasks.find((item) => item.role === 'product')
      const facts = {
        ...draft.intent.facts,
        binding: view.binding,
        definitionDigest: view.definitionDigest,
        goalRef: view.originTaskId
      }
      draft.intent = {
        ...draft.intent,
        facts,
        stageRef: task.stageRef,
        employeeRef: task.employeeRef,
        sourceTask: {
          ...draft.intent.sourceTask,
          spaceId: facts.binding.scope.companyRef,
          taskId: task.taskId,
          runId: randomUUID()
        }
      }
      draft.producer.employeeRef = task.employeeRef
      draft.producer.task = { ...draft.intent.sourceTask }
      draft.inspection = inspectWorkflowPlanProposal(
        {
          ...draft.inspection.proposal,
          binding: facts.binding,
          definitionDigest: facts.definitionDigest,
          goalRef: facts.goalRef
        },
        facts
      )
      if (kind === 'rejected') {
        draft.inspection = { kind, reason: 'plan_json_invalid' }
      }
      if (kind === 'unavailable') {
        delete draft.artifact
        draft.inspection = { kind, reason: 'plan_artifact_missing' }
      }
      view.planningIntent = draft.intent
      view.planDrafts = [draft]
      expect(caseContract.HiveWorkflowCaseViewSchema.parse(view)).toEqual(view)
      if (kind === 'validated') {
        draft.inspection.proposal.goalRef = randomUUID()
        expect(caseContract.HiveWorkflowCaseViewSchema.safeParse(view).success).toBe(false)
      }
    }
  )

  it('validates original session history and UTF-8 bounds without Node globals', () => {
    const cursor = { epoch: 'original-epoch', sequence: 3 }
    const identity = {
      projectId: randomUUID(),
      caseId: randomUUID(),
      taskId: randomUUID(),
      runId: randomUUID()
    }
    const value = {
      ...identity,
      sessionId: 'original-session',
      workspaceId: 'folder:original',
      executionHostId: 'local',
      provider: 'codex',
      history: {
        ok: true,
        page: {
          sessionId: 'original-session',
          epoch: 'original-epoch',
          direction: 'tail',
          items: [
            {
              itemId: 'original-item',
              revision: 1,
              sequence: 3,
              observedAt: 1,
              body: {
                kind: 'message',
                role: 'assistant',
                blocks: [{ type: 'text', text: '原会话 · 🐝' }]
              }
            }
          ],
          submissions: [],
          removedItemIds: [],
          hasOlder: false,
          hasNewer: false,
          window: { oldest: cursor, newest: cursor, nextCursor: cursor },
          liveCursor: cursor
        }
      }
    }
    expect(
      sessionContract.HiveWorkflowCaseSessionReadSchema.parse({ ...identity, direction: 'tail' })
        .limit
    ).toBe(40)
    expect(sessionContract.HiveWorkflowCaseSessionPageSchema.parse(value)).toEqual(value)
    const foreign = structuredClone(value)
    foreign.history.page.sessionId = 'foreign-session'
    expect(sessionContract.HiveWorkflowCaseSessionPageSchema.safeParse(foreign).success).toBe(false)
    value.history.page.items[0].body.blocks[0].text = '验'.repeat(750_000)
    expect(sessionContract.HiveWorkflowCaseSessionPageSchema.safeParse(value).success).toBe(false)
  })
  it('bundles and validates the host digest without Node globals', () => {
    const value = snapshot()
    expect(contract.HiveWorkflowSnapshotSchema.parse(value)).toEqual(value)
    expect(contract.HiveWorkflowPageSchema.parse({ items: [value], nextCursor: null })).toEqual({
      items: [value],
      nextCursor: null
    })
  })

  it.each(['name', 'limit', 'criteria', 'digest'])(
    'rejects a changed %s in the browser',
    (field) => {
      const value = snapshot()
      if (field === 'name') {
        value.name += ' changed'
      }
      if (field === 'limit') {
        value.definition.maxDurationMs += 1000
      }
      if (field === 'criteria') {
        value.definition.stages[0].acceptanceCriteria.push('Changed requirement')
      }
      if (field === 'digest') {
        value.definitionDigest = '0'.repeat(64)
      }
      expect(contract.HiveWorkflowSnapshotSchema.safeParse(value).success).toBe(false)
    }
  )

  it('validates a fixed requirement case in a browser without Node globals', () => {
    const { view, summary } = workflowCaseFixture()
    expect(caseContract.HiveWorkflowCaseViewSchema.parse(view)).toEqual(view)
    expect(
      caseContract.HiveWorkflowCasePageSchema.parse({ items: [summary], nextCursor: null })
    ).toEqual({ items: [summary], nextCursor: null })
  })

  it.each(['approved', 'changes_requested', 'rejected'])(
    'validates a Case with %s review and handoffs without Node globals',
    (decision) => {
      const { view } = workflowCaseEvidenceFixture(decision)
      expect(caseContract.HiveWorkflowCaseViewSchema.parse(view)).toEqual(view)
    }
  )

  it.each(['handoff binding', 'review binding', 'review artifact', 'review code version'])(
    'rejects changed %s in browser evidence',
    (field) => {
      const { view } = workflowCaseEvidenceFixture('approved')
      if (field === 'handoff binding') {
        view.handoffs[0].binding.workflowRevision += 1
      }
      if (field === 'review binding') {
        view.reviews[0].binding.workflowRevision += 1
      }
      if (field === 'review artifact') {
        view.reviews[0].artifact = { ...view.reviews[0].artifact, digest: 'e'.repeat(64) }
      }
      if (field === 'review code version') {
        view.reviews[0].codeVersion = {
          ...view.reviews[0].codeVersion,
          treeDigest: 'e'.repeat(64)
        }
      }
      expect(caseContract.HiveWorkflowCaseViewSchema.safeParse(view).success).toBe(false)
    }
  )

  it.each(['identity', 'definition', 'employee'])(
    'rejects changed case %s in the browser',
    (field) => {
      const { view } = workflowCaseFixture()
      if (field === 'identity') {
        view.binding.workflowRunRef = randomUUID()
      }
      if (field === 'definition') {
        view.workflow.definition.stages[0].acceptanceCriteria.push('Changed')
      }
      if (field === 'employee') {
        view.stageTasks[0].employeeRef = randomUUID()
      }
      expect(caseContract.HiveWorkflowCaseViewSchema.safeParse(view).success).toBe(false)
    }
  )
})
