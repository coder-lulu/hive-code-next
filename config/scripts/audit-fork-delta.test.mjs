import { describe, expect, it } from 'vitest'

import {
  classifyForkPath,
  collectForkDelta,
  parseNameStatus,
  parseRevListCount,
  renderMarkdown,
  sanitizeEndpointMatch
} from './audit-fork-delta.mjs'

describe('parseNameStatus', () => {
  it('parses additions, modifications, deletions, and renames', () => {
    expect(
      parseNameStatus(
        'A\tconfig/product/hivecode.product.json\nM\tsrc/shared/brand.ts\nD\told.ts\nR100\told/name.ts\tnew/name.ts\n'
      )
    ).toEqual([
      { status: 'A', score: null, path: 'config/product/hivecode.product.json', oldPath: null },
      { status: 'M', score: null, path: 'src/shared/brand.ts', oldPath: null },
      { status: 'D', score: null, path: 'old.ts', oldPath: null },
      { status: 'R', score: 100, path: 'new/name.ts', oldPath: 'old/name.ts' }
    ])
  })

  it('rejects malformed status output', () => {
    expect(() => parseNameStatus('not-a-status\n')).toThrow('Unexpected git name-status entry')
  })
})

describe('classifyForkPath', () => {
  it('identifies policy-relevant path classes without treating ordinary files as overlays', () => {
    expect(classifyForkPath('src/main/runtime/rpc/methods/plugins.ts')).toEqual([
      'upstreamCore',
      'rpcSchema'
    ])
    expect(classifyForkPath('src/main/persistence/migrations/001-init.sql')).toEqual([
      'persistence'
    ])
    expect(classifyForkPath('config/product/hivecode.product.json')).toEqual(['productOverlay'])
    expect(classifyForkPath('src/main/ipc/pet-window.ts')).toEqual(['blueprintPet'])
    expect(classifyForkPath('src/main/foo.ts')).toEqual([])
  })
})

describe('parseRevListCount', () => {
  it('returns behind and ahead counts from git left-right output', () => {
    expect(parseRevListCount('7\t42\n')).toEqual({ behind: 7, ahead: 42 })
  })
})

describe('sanitizeEndpointMatch', () => {
  it('keeps only path, line number, and endpoint evidence', () => {
    const sanitized = sanitizeEndpointMatch(
      'head-sha:src/main/cloud.ts:12:const url = "https://user:pass@login.onorca.dev/path?token=do-not-log"; client = "orca-desktop"; apiToken = "secret"',
      'head-sha'
    )

    expect(sanitized).toBe('src/main/cloud.ts:12:login.onorca.dev, orca-desktop')
    expect(sanitized).not.toContain('user:pass')
    expect(sanitized).not.toContain('do-not-log')
    expect(sanitized).not.toContain('secret')
  })
})

describe('collectForkDelta', () => {
  it('collects commit, status, endpoint, and literal evidence through one git adapter', () => {
    const responses = new Map([
      ['rev-parse\u0000--verify\u0000--end-of-options\u0000upstream/main', 'upstream-sha\n'],
      ['rev-parse\u0000--verify\u0000--end-of-options\u0000HEAD', 'head-sha\n'],
      ['merge-base\u0000upstream-sha\u0000head-sha', 'base-sha\n'],
      ['rev-list\u0000--left-right\u0000--count\u0000upstream-sha...head-sha', '1\t2\n'],
      [
        'log\u0000--no-merges\u0000--format=%H%x09%s\u0000upstream-sha..head-sha',
        'commit-sha\tAdd product overlay\n'
      ],
      [
        'diff\u0000--name-status\u0000--no-ext-diff\u0000-M\u0000upstream-sha...head-sha',
        'M\tsrc/shared/brand.ts\nA\tconfig/product/hivecode.product.json\n'
      ]
    ])
    const git = (args) => {
      if (args[0] === 'grep' && args.some((argument) => argument.includes('hivecode'))) {
        return 'src/shared/brand.ts\n'
      }
      if (args[0] === 'grep' && args.some((argument) => argument.includes('onorca'))) {
        return 'head-sha:src/main/cloud.ts:12:https://login.onorca.dev\n'
      }
      const key = args.join('\u0000')
      const value = responses.get(key)
      if (value === undefined) {
        throw new Error(`Unexpected fake git call: ${key}`)
      }
      return value
    }

    const report = collectForkDelta({ base: 'upstream/main', head: 'HEAD', git })

    expect(report).toMatchObject({
      base: 'upstream/main',
      head: 'HEAD',
      mergeBase: 'base-sha',
      baseSha: 'upstream-sha',
      headSha: 'head-sha',
      counts: { behind: 1, ahead: 2, added: 1, modified: 1, deleted: 0, renamed: 0 },
      ownCommits: [{ sha: 'commit-sha', subject: 'Add product overlay' }],
      productOverlayFiles: ['config/product/hivecode.product.json'],
      upstreamCoreFiles: ['src/shared/brand.ts'],
      hivecodeLiteralFiles: ['src/shared/brand.ts'],
      upstreamEndpointMatches: ['src/main/cloud.ts:12:login.onorca.dev']
    })
  })
})

describe('renderMarkdown', () => {
  it('renders a compact human-readable report with machine-counted sections', () => {
    const markdown = renderMarkdown({
      generatedAt: '2026-08-05T00:00:00.000Z',
      base: 'upstream/main',
      head: 'HEAD',
      mergeBase: 'base-sha',
      baseSha: 'upstream-sha',
      headSha: 'head-sha',
      counts: {
        behind: 0,
        ahead: 0,
        added: 0,
        modified: 0,
        deleted: 0,
        renamed: 0,
        copied: 0,
        typeChanged: 0
      },
      ownCommits: [],
      changedFiles: [],
      upstreamCoreFiles: [],
      productOverlayFiles: [],
      hivecodeLiteralFiles: [],
      upstreamEndpointMatches: [],
      rpcSchemaFiles: [],
      persistenceFiles: [],
      blueprintPetFiles: []
    })

    expect(markdown).toContain('# HiveCode Fork Delta Audit')
    expect(markdown).toContain('Merge base: `base-sha`')
    expect(markdown).toContain('Behind / ahead: `0 / 0`')
    expect(markdown).toContain('## Upstream endpoint matches (0)')
  })
})
