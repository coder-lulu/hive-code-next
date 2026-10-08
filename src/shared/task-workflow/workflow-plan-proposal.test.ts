import { describe, expect, it } from 'vitest'
import {
  WORKFLOW_PLAN_LIMITS,
  WorkflowPlanProposalSchema,
  workflowPlanProposalRefusal
} from './workflow-plan-proposal'
import type { WorkflowPlanProposal, WorkflowPlanProposalRefusal } from './workflow-plan-proposal'
import { workflowPlanProposalFixture } from './workflow-plan-proposal.test-fixture'

type PlanTask = WorkflowPlanProposal['tasks'][number]

function task(taskRef: string, dependsOn: string[] = []): PlanTask {
  return { ...workflowPlanProposalFixture().tasks[0], taskRef, dependsOn }
}

function proposalWithTasks(tasks: PlanTask[]): WorkflowPlanProposal {
  return { ...workflowPlanProposalFixture(), tasks }
}

function chain(length: number) {
  return Array.from({ length }, (_, index) =>
    task(`task-${index}`, index === 0 ? [] : [`task-${index - 1}`])
  )
}

function expectRefusal(value: unknown, reason: WorkflowPlanProposalRefusal) {
  expect(workflowPlanProposalRefusal(value)).toBe(reason)
  const parsed = WorkflowPlanProposalSchema.safeParse(value)
  expect(parsed.success).toBe(false)
  if (!parsed.success && reason !== 'plan_invalid') {
    expect(parsed.error.issues.some((issue) => issue.message === reason)).toBe(true)
  }
}

function declaredProposal(): WorkflowPlanProposal {
  return {
    ...workflowPlanProposalFixture(),
    requestedLimits: {
      maxParallelism: 2,
      maxDurationMs: 120_000,
      budget: { costMicros: 100_000, currency: 'USD' }
    },
    resourceSelectionRefs: ['resource-test'],
    requiredCoverage: 'managed_only',
    knowledgeRequirements: [{ sourceRef: 'knowledge-test', required: true }]
  }
}

describe('strict workflow plan proposal data', () => {
  it('preserves a research-only request without creating defaults or mutating its input', () => {
    const proposal = workflowPlanProposalFixture()
    proposal.tasks[0].title = '  Research evidence.  '
    const before = JSON.stringify(proposal)
    expect(workflowPlanProposalRefusal(proposal)).toBeNull()
    expect(WorkflowPlanProposalSchema.parse(proposal)).toEqual(proposal)
    expect(JSON.stringify(proposal)).toBe(before)
    expect(WorkflowPlanProposalSchema.parse(proposal)).not.toHaveProperty('requiredCoverage')
    expect(WorkflowPlanProposalSchema.parse(proposal).requestedLimits).not.toHaveProperty('budget')
    const separate = workflowPlanProposalFixture()
    separate.tasks[0].dependsOn.push('changed-test')
    expect(proposal.tasks[0].dependsOn).toEqual([])
  })

  it.each([
    ['product', 'requirements'],
    ['developer', 'code'],
    ['tester', 'test_report'],
    ['ops', 'release_plan']
  ] as const)('permits a %s request with its own output kind', (requestedRole, outputKind) => {
    const proposal = proposalWithTasks([{ ...task('task-test'), requestedRole, outputKind }])
    expect(WorkflowPlanProposalSchema.parse(proposal)).toEqual(proposal)
    expectRefusal(
      proposalWithTasks([
        {
          ...task('task-test'),
          requestedRole,
          outputKind: outputKind === 'code' ? 'requirements' : 'code'
        }
      ]),
      'plan_output_mismatch'
    )
  })

  it.each([
    'contractVersion',
    'kind',
    'binding',
    'definitionDigest',
    'goalRef',
    'planRevision',
    'tasks',
    'requestedLimits'
  ])('rejects an omitted %s without inferring it', (key) => {
    const proposal = { ...workflowPlanProposalFixture(), [key]: undefined }
    expectRefusal(proposal, 'plan_invalid')
  })

  it.each([
    { contractVersion: 2 },
    { kind: 'workflow.definition' },
    { definitionDigest: 'a'.repeat(63) },
    { definitionDigest: `${'a'.repeat(64)}\n` },
    { goalRef: 'https://test.invalid' },
    { goalRef: 'goal-test\n' },
    { planRevision: 0 },
    { planRevision: 1.5 },
    { planRevision: Number.MAX_SAFE_INTEGER + 1 },
    { tasks: [] }
  ])('rejects malformed fixed identity and contract data %j', (override) => {
    expectRefusal({ ...workflowPlanProposalFixture(), ...override }, 'plan_invalid')
  })

  it.each([0, 4, 1.5, '1'])('rejects invalid maximum attempts %s', (maxAttempts) => {
    expectRefusal(
      { ...workflowPlanProposalFixture(), tasks: [{ ...task('task-test'), maxAttempts }] },
      'plan_invalid'
    )
  })

  it.each([0, 5, 1.5, '1'])('rejects invalid parallelism %s', (maxParallelism) => {
    expectRefusal(
      {
        ...workflowPlanProposalFixture(),
        requestedLimits: { maxParallelism, maxDurationMs: 1000 }
      },
      'plan_invalid'
    )
  })

  it.each([999, 86_400_001, 1000.5, '1000'])('rejects invalid duration %s', (maxDurationMs) => {
    expectRefusal(
      { ...workflowPlanProposalFixture(), requestedLimits: { maxParallelism: 1, maxDurationMs } },
      'plan_invalid'
    )
  })

  it('accepts finite limits at their inclusive maxima', () => {
    const proposal = declaredProposal()
    proposal.tasks[0].maxAttempts = 3
    proposal.requestedLimits = { maxParallelism: 4, maxDurationMs: 86_400_000 }
    proposal.planRevision = Number.MAX_SAFE_INTEGER
    expect(WorkflowPlanProposalSchema.parse(proposal)).toEqual(proposal)
  })
})

describe('bounded business dependency graph', () => {
  it('accepts an eight-node path independent of the input order and preserves that order', () => {
    const tasks = chain(WORKFLOW_PLAN_LIMITS.depth).toReversed()
    const proposal = proposalWithTasks(tasks)
    expect(workflowPlanProposalRefusal(proposal)).toBeNull()
    expect(WorkflowPlanProposalSchema.parse(proposal).tasks).toEqual(tasks)
  })

  it('accepts the densest 32-node DAG with eight layers and rejects a longer path', () => {
    const tasks = Array.from({ length: WORKFLOW_PLAN_LIMITS.tasks }, (_, index) => {
      const precedingCount = Math.floor(index / 4) * 4
      return task(
        `task-${index}`,
        Array.from({ length: precedingCount }, (_, ref) => `task-${ref}`)
      )
    })
    expect(tasks.reduce((total, entry) => total + entry.dependsOn.length, 0)).toBe(448)
    expect(
      WorkflowPlanProposalSchema.parse(proposalWithTasks(tasks.toReversed())).tasks
    ).toHaveLength(32)
    expectRefusal(proposalWithTasks(chain(9).toReversed()), 'plan_depth_exceeded')
  })

  it('tracks the longest branch rather than the first predecessor', () => {
    const tasks = chain(8)
    tasks.push(task('merge-test', ['task-0', 'task-7']))
    expectRefusal(proposalWithTasks(tasks), 'plan_depth_exceeded')
  })

  it.each([
    [() => [task('same-test'), task('same-test')], 'plan_duplicate_task'],
    [
      () => [task('root-test'), task('child-test', ['root-test', 'root-test'])],
      'plan_duplicate_dependency'
    ],
    [() => [task('child-test', ['missing-test'])], 'plan_unknown_dependency'],
    [() => [task('self-test', ['self-test'])], 'plan_dependency_cycle'],
    [
      () => [task('first-test', ['second-test']), task('second-test', ['first-test'])],
      'plan_dependency_cycle'
    ],
    [
      () => [
        task('root-test'),
        task('first-test', ['root-test', 'second-test']),
        task('second-test', ['first-test'])
      ],
      'plan_dependency_cycle'
    ]
  ] as const)('rejects a concrete graph violation with %s', (tasks, reason) => {
    expectRefusal(proposalWithTasks(tasks()), reason)
  })

  it('treats prototype-like opaque references as ordinary graph identities', () => {
    const proposal = proposalWithTasks([task('constructor'), task('toString', ['constructor'])])
    expect(WorkflowPlanProposalSchema.parse(proposal)).toEqual(proposal)
  })
})

describe('declarative resources, knowledge and budget', () => {
  it.each(['managed_only', 'effective_set_verified'] as const)(
    'preserves %s coverage without fabricating loading',
    (requiredCoverage) => {
      const proposal = { ...declaredProposal(), requiredCoverage }
      proposal.knowledgeRequirements?.push({
        sourceRef: 'optional-knowledge-test',
        required: false
      })
      expect(WorkflowPlanProposalSchema.parse(proposal)).toEqual(proposal)
    }
  )

  it('requires resource selectors and coverage together', () => {
    expectRefusal(
      { ...workflowPlanProposalFixture(), resourceSelectionRefs: ['resource-test'] },
      'plan_resource_coverage_required'
    )
    expectRefusal(
      { ...workflowPlanProposalFixture(), requiredCoverage: 'managed_only' },
      'plan_resource_coverage_required'
    )
    expectRefusal({ ...declaredProposal(), resourceSelectionRefs: [] }, 'plan_invalid')
    expectRefusal({ ...declaredProposal(), requiredCoverage: 'all' }, 'plan_invalid')
    expectRefusal({ ...declaredProposal(), knowledgeRequirements: [] }, 'plan_invalid')
  })

  it('rejects duplicate selectors and contradictory knowledge declarations', () => {
    expectRefusal(
      { ...declaredProposal(), resourceSelectionRefs: ['resource-test', 'resource-test'] },
      'plan_duplicate_resource'
    )
    expectRefusal(
      {
        ...declaredProposal(),
        knowledgeRequirements: [
          { sourceRef: 'knowledge-test', required: true },
          { sourceRef: 'knowledge-test', required: false }
        ]
      },
      'plan_duplicate_knowledge'
    )
    expectRefusal(
      {
        ...declaredProposal(),
        knowledgeRequirements: [{ sourceRef: 'knowledge-test', required: 'true' }]
      },
      'plan_invalid'
    )
  })

  it.each([1, Number.MAX_SAFE_INTEGER])(
    'accepts integer costMicros %s without converting units',
    (costMicros) => {
      const proposal = declaredProposal()
      proposal.requestedLimits.budget = { costMicros, currency: 'CNY' }
      expect(WorkflowPlanProposalSchema.parse(proposal).requestedLimits.budget).toEqual({
        costMicros,
        currency: 'CNY'
      })
    }
  )

  it.each([0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, Number.NaN, '1000'])(
    'rejects invalid requested money %s',
    (costMicros) => {
      const proposal = declaredProposal()
      expectRefusal(
        {
          ...proposal,
          requestedLimits: { ...proposal.requestedLimits, budget: { costMicros, currency: 'USD' } }
        },
        'plan_invalid'
      )
    }
  )

  it.each(['US', 'USDD', 'usd', 'Usd', 'USD\n', 'USD\r', 'USD\u2028', ' USD', 'USD '])(
    'rejects a non-exact currency %j',
    (currency) => {
      const proposal = declaredProposal()
      expectRefusal(
        {
          ...proposal,
          requestedLimits: { ...proposal.requestedLimits, budget: { costMicros: 1, currency } }
        },
        'plan_invalid'
      )
    }
  )
})

describe('summary and hostile input boundaries', () => {
  it.each([
    '',
    ' ',
    '\t\r\n',
    '\u00a0\u2003\u202f',
    '\ud800',
    '\udc00',
    'x\ud800x',
    '😀'.repeat(2049)
  ])('rejects blank or malformed Unicode summary %j', (summary) => {
    const proposal = workflowPlanProposalFixture()
    expectRefusal(
      { ...proposal, tasks: [{ ...proposal.tasks[0], title: summary }] },
      'plan_invalid'
    )
    expectRefusal(
      { ...proposal, tasks: [{ ...proposal.tasks[0], acceptance: [summary] }] },
      'plan_invalid'
    )
  })

  it('preserves the 2048-code-point Unicode boundary and sixteen acceptance entries', () => {
    const proposal = workflowPlanProposalFixture()
    proposal.tasks[0].title = '😀'.repeat(2048)
    proposal.tasks[0].acceptance = Array.from({ length: 16 }, () => '😀'.repeat(2048))
    expect(WorkflowPlanProposalSchema.parse(proposal)).toEqual(proposal)
  })

  const extraLocations = [
    (value: WorkflowPlanProposal, key: string) => ({ ...value, [key]: true }),
    (value: WorkflowPlanProposal, key: string) => ({
      ...value,
      binding: { ...value.binding, [key]: true }
    }),
    (value: WorkflowPlanProposal, key: string) => ({
      ...value,
      binding: { ...value.binding, scope: { ...value.binding.scope, [key]: true } }
    }),
    (value: WorkflowPlanProposal, key: string) => ({
      ...value,
      tasks: [{ ...value.tasks[0], [key]: true }]
    }),
    (value: WorkflowPlanProposal, key: string) => ({
      ...value,
      requestedLimits: { ...value.requestedLimits, [key]: true }
    }),
    (value: WorkflowPlanProposal, key: string) => ({
      ...value,
      requestedLimits: {
        ...value.requestedLimits,
        budget: { ...value.requestedLimits.budget, [key]: true }
      }
    }),
    (value: WorkflowPlanProposal, key: string) => ({
      ...value,
      knowledgeRequirements: [{ sourceRef: 'knowledge-test', required: true, [key]: true }]
    })
  ]
  it.each([
    'actor',
    'process',
    'url',
    'cwd',
    'command',
    'env',
    'provider',
    'autohook',
    'auth',
    'authorized',
    'stopProof'
  ])('rejects an added %s field at every object boundary', (key) => {
    for (const addExtra of extraLocations) {
      expectRefusal(addExtra(declaredProposal(), key), 'plan_invalid')
    }
  })

  it.each([
    ['tasks', WORKFLOW_PLAN_LIMITS.tasks + 1],
    ['dependsOn', WORKFLOW_PLAN_LIMITS.dependencies + 1],
    ['acceptance', WORKFLOW_PLAN_LIMITS.acceptance + 1],
    ['resourceSelectionRefs', 17],
    ['knowledgeRequirements', 17]
  ] as const)('refuses oversized %s before visiting any element', (field, length) => {
    const oversized = Array.from({ length })
    Object.defineProperty(oversized, '0', {
      get() {
        throw new Error('Oversized item must not be read.')
      }
    })
    const proposal = declaredProposal()
    const raw =
      field === 'dependsOn' || field === 'acceptance'
        ? { ...proposal, tasks: [{ ...proposal.tasks[0], [field]: oversized }] }
        : { ...proposal, [field]: oversized }
    expect(() => expectRefusal(raw, 'plan_invalid')).not.toThrow()
  })
})
