import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { classifySyncBoundaryPath } from './audit-fork-delta.mjs'

const projectDir = resolve(import.meta.dirname, '../..')
const boundary = JSON.parse(
  readFileSync(join(projectDir, 'config/upstream-sync-boundary.json'), 'utf8')
)
const upstreamSyncWorkflow = readFileSync(
  join(projectDir, '.github/workflows/upstream-sync.yml'),
  'utf8'
)

describe('upstream synchronization boundary', () => {
  it('keeps all three maintained path lists non-empty and distinct', () => {
    const categories = ['productBoundary', 'directAbsorb', 'manualReview']
    for (const category of categories) {
      expect(boundary[category].paths.length, category).toBeGreaterThan(0)
      expect(new Set(boundary[category].paths).size, category).toBe(boundary[category].paths.length)
    }
  })

  it('synchronizes directly on the explicit product main branches', () => {
    expect(boundary.workflow.integrationMode).toBe('direct-product')
    expect(boundary.workflow.integrationBranch).toBeUndefined()
    expect(boundary.workflow.productBranches).toEqual(['hivecode/main-next', 'main'])
    expect(boundary.workflow.publication).toBe('verified-fast-forward')
  })

  it('keeps the large-module migration list tied to behavior contracts', () => {
    expect(boundary.moduleSplitTargets.length).toBeGreaterThan(0)
    expect(new Set(boundary.moduleSplitTargets.map((target) => target.path)).size).toBe(
      boundary.moduleSplitTargets.length
    )
    for (const target of boundary.moduleSplitTargets) {
      expect(existsSync(join(projectDir, target.path)), target.path).toBe(true)
      expect(target.facade, target.path).toEqual(expect.any(String))
      expect(target.sensitivity, target.path).toEqual(expect.any(String))
      expect(target.expectedBoundary, target.path).toBe('manualReview')
      expect(target.boundaryPaths.length, target.path).toBeGreaterThan(0)
      for (const boundaryPath of target.boundaryPaths) {
        expect(classifySyncBoundaryPath(boundaryPath), `${target.path} -> ${boundaryPath}`).toBe(
          'manualReview'
        )
      }
      expect(target.contractTests.length, target.path).toBeGreaterThan(0)
      for (const contractTest of target.contractTests) {
        expect(
          existsSync(join(projectDir, contractTest)),
          `${target.path} -> ${contractTest}`
        ).toBe(true)
      }
    }
  })

  it('publishes only the immutable verified candidate with a normal product push', () => {
    expect(upstreamSyncWorkflow).toContain('git bundle create')
    expect(upstreamSyncWorkflow).toContain('push origin "$CANDIDATE_SHA:refs/heads/$TARGET_BRANCH"')
    expect(upstreamSyncWorkflow).not.toContain('vendor-integration')
    expect(upstreamSyncWorkflow).not.toContain('--force-with-lease')
    expect(upstreamSyncWorkflow).not.toContain('gh pr ')
  })
})
