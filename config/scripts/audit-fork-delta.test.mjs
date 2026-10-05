import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import {
  classifyForkPath,
  classifySyncBoundaryPath,
  collectForkDelta,
  parseArgs,
  parseNameStatus,
  parseRevListCount,
  renderMarkdown,
  sanitizeEndpointMatch
} from './audit-fork-delta.mjs'

it('writes the workflow report summary as Markdown with actual line breaks', () => {
  const workflow = parse(
    readFileSync(new URL('../../.github/workflows/fork-boundary.yml', import.meta.url), 'utf8')
  )
  const step = workflow.jobs.boundary.steps.find(
    (entry) => entry.name === 'Generate fork delta evidence'
  )
  const inline = step.run.match(/node -e '([\s\S]*?)'\s*$/)?.[1]
  expect(inline).toBeDefined()
  const report = {
    baseSha: 'base-source',
    headSha: 'head-source',
    counts: { behind: 2, ahead: 3 },
    ...Object.fromEntries(
      [
        'changedFiles',
        'upstreamCoreFiles',
        'productOverlayFiles',
        'productBoundaryFiles',
        'directAbsorbFiles',
        'manualReviewFiles',
        'rpcSchemaFiles',
        'persistenceFiles',
        'blueprintPetFiles',
        'upstreamEndpointMatches'
      ].map((name) => [name, []])
    )
  }
  let summary = ''
  runInNewContext(inline, {
    process: { env: { REPORT: 'report.json', GITHUB_STEP_SUMMARY: 'summary.md' } },
    require: (name) => {
      expect(name).toBe('node:fs')
      return {
        readFileSync: (path) => {
          expect(path).toBe('report.json')
          return JSON.stringify(report)
        },
        appendFileSync: (path, content) => {
          expect(path).toBe('summary.md')
          summary += content
        }
      }
    }
  })
  expect(summary.split('\n').slice(0, 4)).toEqual([
    '## Fork boundary evidence',
    '- Base: `base-source`',
    '- Head: `head-source`',
    '- Behind / ahead: `2 / 3`'
  ])
  expect(summary).toContain('- Upstream endpoint matches: `0`\n')
  expect(summary).not.toContain('\\n')
})

describe('explicit tree comparison for public root imports', () => {
  function withUnrelatedRoots(run) {
    const scratch = new URL('../../logs/open-source-baseline/tmp/', import.meta.url)
    mkdirSync(scratch, { recursive: true })
    const root = mkdtempSync(path.join(fileURLToPath(scratch), 'fork-trees-'))
    const git = (args) =>
      execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    function snapshot(files) {
      git(['read-tree', '--empty'])
      for (const [name, content] of Object.entries(files)) {
        const destination = path.join(root, name)
        mkdirSync(path.dirname(destination), { recursive: true })
        writeFileSync(destination, content)
        git(['add', '--', name])
      }
      return git([
        'commit-tree',
        git(['write-tree']).trim(),
        '-m',
        'independent source snapshot'
      ]).trim()
    }
    try {
      git(['init', '--quiet'])
      git(['config', 'user.name', 'Fork Audit Test'])
      git(['config', 'user.email', 'fork-audit@example.test'])
      git(['config', 'commit.gpgSign', 'false'])
      const base = snapshot({
        'README.md': 'upstream',
        'removed.md': 'deleted upstream page',
        'src/shared/protocol.ts': 'old protocol'
      })
      const head = snapshot({
        'README.md': 'HiveCode',
        'added.md': 'public page',
        'src/shared/protocol.ts': 'new protocol',
        'config/product/identity.json': '{"product":"HiveCode"}'
      })
      run({ base, head, git })
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  }

  it('compares actual unrelated trees without ancestry claims and retains every boundary delta', () => {
    withUnrelatedRoots(({ base, head, git }) => {
      const report = collectForkDelta({ base, head, comparison: 'trees', git })
      expect(report).toMatchObject({
        comparison: 'trees',
        mergeBase: null,
        ownCommits: null,
        counts: { behind: null, ahead: null, added: 2, modified: 2, deleted: 1 },
        productOverlayFiles: ['config/product/identity.json'],
        upstreamCoreFiles: ['src/shared/protocol.ts']
      })
      expect(report.changedFiles.map((change) => change.path)).toEqual([
        'README.md',
        'added.md',
        'config/product/identity.json',
        'removed.md',
        'src/shared/protocol.ts'
      ])
      const markdown = renderMarkdown(report)
      expect(markdown).toContain('Comparison: `trees`')
      expect(markdown).toContain('Merge base: `N/A`')
      expect(markdown).toContain('Behind / ahead: `N/A / N/A`')
      expect(markdown).toContain('Non-merge commits unique to head (N/A)')
      expect(markdown).toContain('Not applicable to a tree comparison')
    })
  })
  it('keeps default ancestry mode failing for unrelated histories', () => {
    withUnrelatedRoots(({ base, head, git }) => {
      expect(() => collectForkDelta({ base, head, git })).toThrow()
    })
  })
  it('regenerates both trusted CI deltas from actual public and upstream trees', () => {
    const workflow = parse(
      readFileSync(new URL('../../.github/workflows/upstream-sync.yml', import.meta.url), 'utf8')
    )
    const step = Object.values(workflow.jobs)
      .flatMap((job) => job.steps ?? [])
      .find(
        (item) =>
          item.name === 'Regenerate trusted fork and product evidence after candidate execution'
      )
    const loop = step.run.slice(
      step.run.indexOf('for (const [name, base]'),
      step.run.lastIndexOf('\nNODE')
    )
    withUnrelatedRoots(({ base, head, git }) => {
      const outputs = new Map()
      runInNewContext(loop, {
        process: {
          env: {
            UPSTREAM_SHA: base,
            TARGET_SHA: head,
            CANDIDATE_SHA: head,
            GITHUB_WORKSPACE: '/fixture'
          }
        },
        collectForkDelta: (options) => collectForkDelta({ ...options, git }),
        renderMarkdown,
        writeFileSync: (file, contents) => outputs.set(file, contents)
      })
      const fork = JSON.parse(outputs.get('/fixture/logs/upstream-sync/evidence/fork-delta.json'))
      const product = JSON.parse(
        outputs.get('/fixture/logs/upstream-sync/evidence/product-delta.json')
      )
      expect(fork).toMatchObject({
        comparison: 'trees',
        baseSha: base,
        headSha: head,
        mergeBase: null
      })
      expect(fork.changedFiles).toHaveLength(5)
      expect(product).toMatchObject({ comparison: 'trees', baseSha: head, headSha: head })
      expect(product.changedFiles).toEqual([])
      expect(outputs.size).toBe(4)
    })
  })
  it('rejects unknown modes and missing refs instead of reporting an empty comparison', () => {
    withUnrelatedRoots(({ base, head, git }) => {
      expect(() => collectForkDelta({ base, head, comparison: 'guess', git })).toThrow(
        'Unsupported comparison mode'
      )
      expect(() =>
        collectForkDelta({ base: 'missing-upstream', head, comparison: 'trees', git })
      ).toThrow()
    })
  })
  it('requires an explicit tree CLI option and rejects malformed modes', () => {
    expect(parseArgs(['--comparison', 'trees'])).toMatchObject({ comparison: 'trees' })
    expect(() => parseArgs(['--comparison', 'guess'])).toThrow('Unsupported comparison mode')
    expect(() => parseArgs(['--comparison'])).toThrow('--comparison requires a value')
  })
  it('makes the Fork Boundary caller explicit and labels absent ancestry counts N/A', () => {
    const workflow = parse(
      readFileSync(new URL('../../.github/workflows/fork-boundary.yml', import.meta.url), 'utf8')
    )
    const run = workflow.jobs.boundary.steps.find(
      (step) => step.name === 'Generate fork delta evidence'
    ).run
    expect(run.match(/--comparison trees/g)).toHaveLength(2)
    const inline = run.match(/node -e '([\s\S]*?)'\s*$/)?.[1]
    let summary = ''
    runInNewContext(inline, {
      process: { env: { REPORT: 'report.json', GITHUB_STEP_SUMMARY: 'summary.md' } },
      require: () => ({
        readFileSync: () =>
          JSON.stringify({
            baseSha: 'upstream',
            headSha: 'product',
            counts: { behind: null, ahead: null },
            ...Object.fromEntries(
              [
                'changedFiles',
                'upstreamCoreFiles',
                'productOverlayFiles',
                'productBoundaryFiles',
                'directAbsorbFiles',
                'manualReviewFiles',
                'rpcSchemaFiles',
                'persistenceFiles',
                'blueprintPetFiles',
                'upstreamEndpointMatches'
              ].map((name) => [name, []])
            )
          }),
        appendFileSync: (_file, text) => {
          summary += text
        }
      })
    })
    expect(summary).toContain('- Behind / ahead: `N/A / N/A`')
    expect(summary).not.toContain('null')
  })
})

it('can be imported by the inline workflow without a CLI script argument', () => {
  const moduleUrl = new URL('./audit-fork-delta.mjs', import.meta.url).href
  expect(
    execFileSync(
      process.execPath,
      ['--input-type=module', '--eval', `await import(${JSON.stringify(moduleUrl)})`],
      {
        encoding: 'utf8',
        windowsHide: true
      }
    )
  ).toBe('')
})

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

describe('classifySyncBoundaryPath', () => {
  it('gives product and manual-review paths precedence over broad absorb paths', () => {
    expect(classifySyncBoundaryPath('src/shared/generated/product-config.ts')).toBe(
      'productBoundary'
    )
    expect(classifySyncBoundaryPath('src/main/runtime/rpc/methods/session.ts')).toBe('manualReview')
    expect(classifySyncBoundaryPath('src/shared/remote-wire.ts')).toBe('directAbsorb')
    expect(classifySyncBoundaryPath('cloud/apps/relay/src/index.ts')).toBe('productBoundary')
    expect(classifySyncBoundaryPath('src/renderer/src/App.tsx')).toBeNull()
  })

  it('keeps every large-module facade and extracted implementation on manual review', () => {
    const manualReviewPaths = [
      'src/main/git/runner.ts',
      'src/main/git/command-runner/git-exec-file.ts',
      'src/renderer/src/components/terminal-pane/pty-connection.ts',
      'src/renderer/src/components/terminal-pane/pty-connection/connect-pane-pty.ts',
      'src/renderer/src/web/web-runtime-client.ts',
      'src/renderer/src/web/web-runtime-client-protocol.ts',
      'src/renderer/src/web/web-preload-api.ts',
      'src/renderer/src/web/preload-api/web-runtime-api.ts',
      'src/main/window/createMainWindow.ts',
      'src/main/window/main-window-state-lifecycle.ts',
      'src/main/providers/ssh-git-provider.ts',
      'src/main/providers/ssh-git-provider-status.ts'
    ]
    for (const path of manualReviewPaths) {
      expect(classifySyncBoundaryPath(path), path).toBe('manualReview')
    }
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
