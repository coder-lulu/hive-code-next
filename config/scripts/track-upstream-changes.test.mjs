import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  classifyUpstreamChange,
  collectUpstreamChanges,
  loadPriorityManifest,
  renderMarkdown
} from './track-upstream-changes.mjs'

const projectDir = resolve(import.meta.dirname, '../..')
const manifest = loadPriorityManifest(join(projectDir, 'config/upstream-change-priority.json'))

describe('upstream change intake priority', () => {
  it('keeps all six ordered priorities and defaults unknown work to manual review', () => {
    expect(manifest.priorities.map((priority) => priority.level)).toEqual([1, 2, 3, 4, 5, 6])
    expect(manifest.defaultPriority).toBe(6)
    expect(
      classifyUpstreamChange({ subject: 'new thing', paths: ['src/unknown/new.ts'], manifest })
    ).toMatchObject({
      priority: 6,
      reviewRequired: true
    })
  })

  it('lets security and consistency wins outrank stability and refactor matches', () => {
    const result = classifyUpstreamChange({
      subject: 'security fix for SSH reconnect',
      paths: ['src/main/ssh/client.ts', 'src/main/persistence/migrations.ts'],
      manifest
    })
    expect(result.priority).toBe(1)
    expect(result.priorityId).toBe('security-data-consistency')
    expect(result.matchedRuleCount).toBeGreaterThan(1)
  })

  it.each([
    'fix(daemon): pause producers when stream backlogs grow',
    'fix(browser): bound CDP output for stalled clients',
    'Bound AI Vault transcript record assembly before allocation',
    'fix(plugins): release diagnostic logs after successful uninstall',
    'fix: retire closed editor models from the app shell',
    'Fix stale Codex usage after reset'
  ])('promotes resource and data-correctness fixes: %s', (subject) => {
    expect(
      classifyUpstreamChange({ subject, paths: ['src/unknown/new.ts'], manifest })
    ).toMatchObject({
      priority: 1,
      priorityId: 'security-data-consistency'
    })
  })

  it('tracks commits from an explicit vendor base without relying on live git state', () => {
    const responses = new Map([
      ['rev-parse:a', 'base-sha'],
      ['rev-parse:b', 'head-sha'],
      ['log', 'c1\tfix: improve relay reconnect\nc2\trefactor: split module\n'],
      ['diff-tree:c1', 'src/relay/client.ts\n'],
      ['diff-tree:c2', 'src/shared/module.ts\n']
    ])
    const git = (args) => {
      const key =
        args[0] === 'rev-parse'
          ? `${args[0]}:${args.at(-1)}`
          : args[0] === 'diff-tree'
            ? `${args[0]}:${args.at(-1)}`
            : args[0]
      const value = responses.get(key)
      if (value === undefined) {
        throw new Error(`unexpected git call: ${args.join(' ')}`)
      }
      return value
    }
    const report = collectUpstreamChanges({ base: 'a', head: 'b', git, manifest })
    expect(report.baseSha).toBe('base-sha')
    expect(report.headSha).toBe('head-sha')
    expect(report.changes.map((change) => change.priority)).toEqual([2, 5])
    expect(renderMarkdown(report, manifest)).toContain(
      'Priority 2: PTY, WSL, SSH, and Relay stability'
    )
  })

  it('keeps the priority manifest reviewable as repository data', () => {
    const source = readFileSync(join(projectDir, 'config/upstream-change-priority.json'), 'utf8')
    expect(JSON.parse(source).description).toContain('Ordered intake policy')
  })
})
