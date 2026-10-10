import { createServer } from 'node:http'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHiveTaskServiceContext } from './hive-task-service-context'
import { workflowCaseCapacityFixture } from './hive-workflow-case-capacity.test-fixture'
import {
  HiveWorkflowCaseViewSchema,
  HiveWorkflowCaseCreateReplySchema
} from '../../shared/hive-workflow-cases'
import { JsonTextStructureValidator } from '../../shared/json-text-structure-limit'
import {
  HIVE_WORKFLOW_CASE_RESPONSE_BYTES,
  HIVE_WORKFLOW_CASE_RESPONSE_STRUCTURAL_TOKENS,
  HIVE_WORKFLOW_CASE_RESPONSE_PARTS
} from '../../shared/hive-workflow-case-response-budget'

describe('original service context Case response capacity', () => {
  const view = workflowCaseCapacityFixture()
  let directory: string
  let body = ''
  let context: Awaited<ReturnType<ReturnType<typeof createHiveTaskServiceContext>>>
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json')
    response.end(body)
  })
  beforeAll(async () => {
    const logs = resolve('logs/paperclip-development/20261010-plan-draft/backend/capacity-tmp')
    await mkdir(logs, { recursive: true })
    const encoded = JSON.stringify(view)
    const structure = new JsonTextStructureValidator({
      nestingDepth: 16,
      structuralTokens: HIVE_WORKFLOW_CASE_RESPONSE_STRUCTURAL_TOKENS
    })
    structure.consume(encoded)
    await writeFile(
      resolve(logs, '..', 'capacity-response-measurements.json'),
      JSON.stringify(
        {
          synthetic: true,
          responseBytes: Buffer.byteLength(encoded),
          jsonStringUnits: encoded.length,
          structure: structure.usage(),
          planCount: view.planDrafts.length,
          originalPlanBytes: view.planDrafts.map((draft) =>
            draft.inspection.kind === 'validated'
              ? Buffer.byteLength(JSON.stringify(draft.inspection.proposal))
              : null
          ),
          handoffs: view.handoffs.length,
          dependenciesPerHandoff: view.handoffs[0].dependencyVersions.length,
          reviews: view.reviews.length,
          notices: view.executionNotices.length,
          componentBytesUpperBound: Object.values(HIVE_WORKFLOW_CASE_RESPONSE_PARTS).reduce(
            (sum, part) => sum + part.count * part.bytes,
            0
          ),
          componentTokensUpperBound: Object.values(HIVE_WORKFLOW_CASE_RESPONSE_PARTS).reduce(
            (sum, part) => sum + part.count * part.structuralTokens,
            0
          )
        },
        null,
        2
      )
    )
    directory = await realpath(await mkdtemp(join(logs, 'context-')))
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Test listener unavailable')
    }
    const descriptorPath = join(directory, 'descriptor.json')
    await writeFile(
      descriptorPath,
      JSON.stringify({ baseUrl: `http://127.0.0.1:${address.port}/`, secret: 'a'.repeat(43) })
    )
    context = await createHiveTaskServiceContext({
      descriptorPath,
      assertCurrent: () => undefined,
      currentAccount: () => ({
        accountId: 'capacity-owner',
        authorityId: 'capacity-authority',
        sessionGeneration: 1,
        sessionExpiresAt: Date.now() + 60_000,
        accessToken: 'synthetic-token'
      })
    })()
  })
  afterAll(async () => {
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done()))
    )
    if (directory) {
      await rm(directory, { recursive: true, force: true })
    }
  })
  it('bounds every declared component and their aggregate independently of the example size', () => {
    const parts = HIVE_WORKFLOW_CASE_RESPONSE_PARTS
    expect(
      Object.values(parts).reduce((sum, part) => sum + part.count * part.bytes, 0)
    ).toBeLessThan(HIVE_WORKFLOW_CASE_RESPONSE_BYTES)
    expect(
      Object.values(parts).reduce((sum, part) => sum + part.count * part.structuralTokens, 0)
    ).toBeLessThan(HIVE_WORKFLOW_CASE_RESPONSE_STRUCTURAL_TOKENS)
    const { planningIntent, planDrafts, handoffs, reviews, executionNotices, ...base } = view
    const groups = {
      base: { items: [base], budget: parts.base },
      intent: { items: [planningIntent], budget: parts.intent },
      drafts: { items: planDrafts, budget: parts.drafts },
      handoffs: { items: handoffs, budget: parts.handoffs },
      reviews: { items: reviews, budget: parts.reviews },
      notices: { items: executionNotices, budget: parts.notices }
    }
    for (const { items, budget } of Object.values(groups)) {
      expect(items).toHaveLength(budget.count)
      for (const item of items) {
        const text = JSON.stringify(item)
        expect(Buffer.byteLength(text)).toBeLessThan(budget.bytes)
        const validator = new JsonTextStructureValidator({
          nestingDepth: 16,
          structuralTokens: budget.structuralTokens
        })
        expect(() => validator.consume(text)).not.toThrow()
      }
    }
    for (const draft of planDrafts) {
      expect(draft.inspection.kind).toBe('validated')
      if (draft.inspection.kind === 'validated') {
        expect(Buffer.byteLength(JSON.stringify(draft.inspection.proposal))).toBe(131072)
      }
    }
  })
  it('round-trips all three maximal proposals and existing evidence over actual loopback HTTP', async () => {
    body = JSON.stringify(view)
    expect(Buffer.byteLength(body)).toBeGreaterThan(512 * 1024)
    expect(
      HiveWorkflowCaseViewSchema.parse(await context.request('/hive/workbench/cases/read', {}))
    ).toEqual(view)
    for (const replayed of [false, true]) {
      const reply = {
        view,
        admission: {
          requestId: randomUUID(),
          caseId: view.id,
          payloadFingerprint: 'a'.repeat(64),
          replayed
        }
      }
      body = JSON.stringify(reply)
      expect(
        HiveWorkflowCaseCreateReplySchema.parse(
          await context.request('/hive/workbench/cases/create', {})
        )
      ).toEqual(reply)
    }
    await expect(context.request('/hive/workbench/companies/list', {})).rejects.toThrow(
      'SERVICE_UNAVAILABLE'
    )
  })
  it('still refuses byte, structural and nesting overflow on the expanded Case routes', async () => {
    for (const path of ['/hive/workbench/cases/read', '/hive/workbench/cases/create']) {
      for (const oversized of [
        JSON.stringify('x'.repeat(HIVE_WORKFLOW_CASE_RESPONSE_BYTES)),
        `[${Array(HIVE_WORKFLOW_CASE_RESPONSE_STRUCTURAL_TOKENS + 1)
          .fill('0')
          .join(',')}]`,
        `${'['.repeat(17)}0${']'.repeat(17)}`
      ]) {
        body = oversized
        await expect(context.request(path, {})).rejects.toThrow('SERVICE_UNAVAILABLE')
      }
    }
  })
  it('preserves array and string field limits after the transport expansion', () => {
    expect(
      HiveWorkflowCaseViewSchema.safeParse({
        ...view,
        planDrafts: [...view.planDrafts, view.planDrafts[0]]
      }).success
    ).toBe(false)
    expect(
      HiveWorkflowCaseViewSchema.safeParse({ ...view, requirement: 'x'.repeat(48_001) }).success
    ).toBe(false)
  })
})
