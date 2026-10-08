import { build } from 'esbuild'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { beforeAll, describe, expect, it } from 'vitest'
import { canonicalAgentSessionDigest } from '../../src/shared/agent-session-mutation-envelope.ts'
import { workflowCaseFixture } from '../../src/shared/hive-workflow-cases.test-fixture.ts'
import { workflowCaseEvidenceFixture } from '../../src/renderer/src/components/task-page/hive/hive-workflow-case-evidence.test-fixtures.ts'
import { workflowTestVectors } from '../../src/shared/task-workflow/workflow.test-fixture.ts'

let contract
let caseContract

beforeAll(async () => {
  const bundles = await Promise.all(
    ['hive-task-workflows', 'hive-workflow-cases'].map((module) =>
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
  ;[contract, caseContract] = bundles.map((bundle) =>
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
