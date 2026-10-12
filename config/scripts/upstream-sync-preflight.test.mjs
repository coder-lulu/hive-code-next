import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { verifyFrozenProductTip } from './upstream-sync-preflight.mjs'

const target = 'a'.repeat(40)
const ref = 'refs/heads/hivecode/main-next'
const remoteGit = (rows) => (args) => (args[0] === 'rev-parse' ? `${target}\n` : rows)

describe('upstream sync early product preflight', () => {
  it('accepts only the exact frozen branch and does not claim final acceptance', () => {
    expect(verifyFrozenProductTip({ target, git: remoteGit(`${target}\t${ref}\n`) })).toEqual({
      check: 'frozen-product-tip',
      targetBranch: 'hivecode/main-next',
      targetSha: target,
      passed: true,
      formalAcceptance: false
    })
  })

  it('stops before expensive verification when product main changes', () => {
    expect(() =>
      verifyFrozenProductTip({ target, git: remoteGit(`${'b'.repeat(40)}\t${ref}\n`) })
    ).toThrow(/main moved.*refresh the candidate/)
  })

  it.each([
    '',
    `bad\t${ref}`,
    `${target}\trefs/heads/main`,
    `${target}\t${ref}\n${target}\t${ref}`
  ])('rejects missing, malformed, wrong-branch or ambiguous remote evidence: %s', (rows) => {
    expect(() => verifyFrozenProductTip({ target, git: remoteGit(rows) })).toThrow(
      /exact branch tip/
    )
  })

  it('does not turn a remote failure into unchanged-main evidence', () => {
    const git = (args) => {
      if (args[0] === 'rev-parse') {
        return target
      }
      throw new Error('remote unavailable')
    }
    expect(() => verifyFrozenProductTip({ target, git })).toThrow('remote unavailable')
  })

  it.each([
    { target: 'HEAD' },
    { target, targetBranch: 'feature/unreviewed' },
    { target, remote: '--upload-pack=anything' }
  ])('rejects unpinned or unsafe input before remote execution: %j', (options) => {
    expect(() =>
      verifyFrozenProductTip({
        ...options,
        git: () => {
          throw new Error('must not execute')
        }
      })
    ).toThrow(/requires/)
  })

  it('keeps daily intake serialized and checks main before candidate dependencies on every OS', () => {
    const workflow = parse(
      readFileSync(
        resolve(import.meta.dirname, '../../.github/workflows/upstream-sync.yml'),
        'utf8'
      )
    )
    expect(workflow.on.schedule).toEqual([{ cron: '17 2 * * *' }])
    expect(workflow.concurrency).toEqual({
      group: 'hivecode-upstream-sync',
      'cancel-in-progress': false
    })
    for (const job of [workflow.jobs.gates, workflow.jobs['platform-gates']]) {
      expect(job.permissions).toEqual({ contents: 'read' })
      const tip = job.steps.findIndex((step) => step.run?.includes('upstream-sync-preflight.mjs'))
      const install = job.steps.findIndex(
        (step) => step.uses === './.github/actions/install-node-dependencies'
      )
      expect(tip).toBeGreaterThan(-1)
      expect(tip).toBeLessThan(install)
      expect(job.steps[tip].run).toContain('$RUNNER_TEMP/upstream-sync-control/config/scripts/')
      expect(job.steps[tip].run).toContain('--target "$TARGET_SHA"')
      expect(
        job.steps.some((step) =>
          step.run?.includes("phase: 'final', formalAcceptance: true, omittedChecks: []")
        )
      ).toBe(true)
    }
    const publication = workflow.jobs.publish.steps.map((step) => step.run ?? '').join('\n')
    expect(publication).toContain('git ls-remote origin')
    expect(publication).toMatch(
      /git (?:-c core\.hooksPath=\/dev\/null )?push origin "\$CANDIDATE_SHA:refs\/heads\/\$TARGET_BRANCH"/
    )
    expect(publication).not.toContain('--force')
  })
})
