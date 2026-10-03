import { describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import {
  checkDocumentationGovernance,
  parseTrackedEntries,
  verifyDocumentationGovernance
} from './verify-documentation-governance.mjs'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const privateURL = 'https://github.com/coder-lulu/hive-code-docs.git'
const policyPath = 'config/private-document-fingerprints.json'
const sourceCommit = '7d1e91561ecab41e4b7c8b9a63a8f759fc378894'
const privateBlob = 'b'.repeat(40)
const requiredSections = [
  '## 1. 文档权威与维护规则',
  '## 3. 当前能力基线',
  '## 4. 总体架构',
  '## 5. 功能设计',
  '## 7. 开发路线',
  '## 10. 已合并资料处置'
]
function fixture() {
  const contents = {
    'README.md': `[Private documentation](${privateURL})`,
    '.gitmodules': `[submodule "docs"]\npath = docs\nurl = ${privateURL}\n`,
    [policyPath]: '{}'
  }
  return {
    contents,
    entries: [
      { path: 'docs', mode: '160000', objectSha: 'a'.repeat(40), stage: 0 },
      ...Object.keys(contents).map((filePath) => ({
        path: filePath,
        mode: '100644',
        objectSha: 'c'.repeat(40),
        stage: 0
      }))
    ],
    submodules: [{ path: 'docs', url: privateURL }],
    fingerprints: {
      schemaVersion: 1,
      sourceCommit,
      algorithm: 'git-blob-sha1',
      blobs: [privateBlob]
    }
  }
}
function verify(f = fixture()) {
  return verifyDocumentationGovernance({
    ...f,
    files: f.entries.map((entry) => entry.path),
    readText: (filePath) => f.contents[filePath]
  })
}

describe('public documentation separation boundary', () => {
  it('accepts the exact pinned private gitlink without accessing private prose', () => {
    const f = fixture()
    const readText = vi.fn((filePath) => {
      if (filePath === 'docs' || filePath.startsWith('docs/')) {
        throw new Error('Private content must not be read')
      }
      return f.contents[filePath]
    })
    expect(
      verifyDocumentationGovernance({ ...f, files: f.entries.map((entry) => entry.path), readText })
    ).toEqual([])
    expect(readText.mock.calls.every(([filePath]) => !filePath.startsWith('docs/'))).toBe(true)
  })
  it.each(['100644', '120000'])('rejects docs as an ordinary file or symlink (%s)', (mode) => {
    const f = fixture()
    f.entries[0].mode = mode
    expect(verify(f)).toContain(
      'docs must be exactly one pinned stage-0 Git submodule (mode 160000)'
    )
  })
  it('rejects missing, unmerged and duplicate docs entries', () => {
    for (const mutate of [
      (f) => f.entries.shift(),
      (f) => {
        f.entries[0].stage = 2
      },
      (f) => f.entries.push(f.entries[0])
    ]) {
      const f = fixture()
      mutate(f)
      expect(verify(f)).toContain(
        'docs must be exactly one pinned stage-0 Git submodule (mode 160000)'
      )
    }
  })
  it.each([
    'https://github.com/other/docs.git',
    '../hive-code-docs',
    'https://github.com/coder-lulu/hive-code-next.git'
  ])('rejects a different submodule authority: %s', (url) => {
    const f = fixture()
    f.submodules[0].url = url
    expect(verify(f)).toContain(
      'docs must bind exactly once to the private coder-lulu/hive-code-docs repository'
    )
  })
  it('rejects missing/duplicate bindings and an untracked fingerprint policy', () => {
    const missing = fixture()
    missing.submodules = []
    expect(verify(missing)).toContain(
      'docs must bind exactly once to the private coder-lulu/hive-code-docs repository'
    )
    const duplicate = fixture()
    duplicate.submodules.push(duplicate.submodules[0])
    expect(verify(duplicate)).toContain(
      'docs must bind exactly once to the private coder-lulu/hive-code-docs repository'
    )
    const untracked = fixture()
    untracked.entries = untracked.entries.filter((entry) => entry.path !== policyPath)
    expect(verify(untracked)).toContain(
      'Private document fingerprint policy must be tracked as a regular public file'
    )
  })
  it('rejects public docs descendants without reading their contents', () => {
    const f = fixture()
    f.entries.push({
      path: 'docs/reference/internal.md',
      mode: '100644',
      objectSha: 'd'.repeat(40),
      stage: 0
    })
    expect(verify(f)).toContain(
      'Private documentation must not be tracked in the public repository: docs/reference/internal.md'
    )
  })
  it('rejects a fingerprinted private body under any public filename or extension', () => {
    const f = fixture()
    f.entries.push({
      path: 'resources/renamed.bin',
      mode: '100644',
      objectSha: privateBlob,
      stage: 0
    })
    f.contents['resources/renamed.bin'] =
      'Fingerprint identity is checked independently of this text'
    expect(verify(f)).toContain(
      'Private document body is duplicated in a public file: resources/renamed.bin'
    )
  })
  it.each([
    null,
    { schemaVersion: 1, sourceCommit, algorithm: 'git-blob-sha1', blobs: [] },
    { schemaVersion: 1, sourceCommit, algorithm: 'sha256', blobs: [privateBlob] },
    { schemaVersion: 1, sourceCommit: 'wrong', algorithm: 'git-blob-sha1', blobs: [privateBlob] },
    {
      schemaVersion: 1,
      sourceCommit,
      algorithm: 'git-blob-sha1',
      blobs: [privateBlob, privateBlob]
    }
  ])('fails closed for missing or invalid private fingerprint policy', (fingerprints) => {
    const f = fixture()
    f.fingerprints = fingerprints
    expect(verify(f)).toContain('Private document fingerprint policy is missing, empty or invalid')
  })
  it('rejects canonical internal design prose renamed and edited in a public document', () => {
    const f = fixture()
    const filePath = 'resources/renamed-guide.md'
    f.entries.push({ path: filePath, mode: '100644', objectSha: 'd'.repeat(40), stage: 0 })
    f.contents[filePath] = `${requiredSections.join('\n')}\nEdited design contents`
    expect(verify(f)).toContain(`Internal product design prose must remain private: ${filePath}`)
  })
  it('runs the guard on every PR before readiness reuse and on submodule/fingerprint changes', () => {
    const workflow = parse(readFileSync(path.join(repoRoot, '.github/workflows/pr.yml'), 'utf8'))
    const job = workflow.jobs.code_paths
    const guard = job.steps.find((step) => step.name === 'Verify private documentation boundary')
    const reuse = job.steps.findIndex(
      (step) => step.name === 'Find identical successful required checks'
    )
    expect(job.if).toBeUndefined()
    expect(guard?.if).toBeUndefined()
    expect(guard?.run).toBe('node config/scripts/verify-documentation-governance.mjs')
    expect(job.steps.indexOf(guard)).toBeLessThan(reuse)
    const checkout = job.steps.find((step) => step.uses?.startsWith('actions/checkout@'))
    expect(checkout.with['sparse-checkout']).not.toContain('/docs/readme/')
    expect(checkout.with['sparse-checkout']).toContain('/.gitmodules')
    expect(checkout.with['sparse-checkout']).toContain(`/${policyPath}`)
    const fork = parse(
      readFileSync(path.join(repoRoot, '.github/workflows/fork-boundary.yml'), 'utf8')
    )
    expect(fork.on.pull_request.paths).toEqual(expect.arrayContaining(['.gitmodules', policyPath]))
  })
})

describe('staged public documentation boundary', () => {
  function withIndex(run) {
    const scratch = path.join(repoRoot, 'logs/all-platform-build/docs-separation/tmp')
    mkdirSync(scratch, { recursive: true })
    const root = mkdtempSync(path.join(scratch, 'public-index-'))
    const env = {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: path.join(root, 'no-global-config')
    }
    for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) {
      delete env[name]
    }
    const git = (args) =>
      execFileSync('git', args, {
        cwd: root,
        env,
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      }).trim()
    const write = (filePath, content) => {
      const destination = path.join(root, filePath)
      mkdirSync(path.dirname(destination), { recursive: true })
      writeFileSync(destination, content)
    }
    try {
      git(['init', '--quiet'])
      write('README.md', `[Private docs](${privateURL})`)
      write('.gitmodules', `[submodule "docs"]\npath = docs\nurl = ${privateURL}\n`)
      write(policyPath, JSON.stringify(fixture().fingerprints))
      git(['add', 'README.md', '.gitmodules', policyPath])
      git(['update-index', '--add', '--cacheinfo', `160000,${'a'.repeat(40)},docs`])
      run({ root, git, write })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  it('uses staged policy and bindings with no private checkout, including sparse public files', () => {
    withIndex(({ root, write }) => {
      write('.gitmodules', '[submodule "docs"]\npath = docs\nurl = ../wrong-authority\n')
      write(policyPath, '{}')
      rmSync(path.join(root, 'README.md'))
      expect(checkDocumentationGovernance(root)).toEqual([])
    })
  })
  it('rejects exact private prose renamed into a non-document public file by index identity', () => {
    withIndex(({ root, git, write }) => {
      write('resources/renamed.bin', 'Private narrative copied under a different public name')
      git(['add', 'resources/renamed.bin'])
      const blob = git(['rev-parse', ':resources/renamed.bin'])
      write(policyPath, JSON.stringify({ ...fixture().fingerprints, blobs: [blob] }))
      git(['add', policyPath])
      expect(checkDocumentationGovernance(root)).toContain(
        'Private document body is duplicated in a public file: resources/renamed.bin'
      )
    })
  })
  it.each([
    'renamed-guide.md',
    'resources/renamed-guide.mdx',
    'renamed-guide.html',
    'resources/renamed-guide.htm'
  ])('rejects edited canonical sections through the actual staged grep owner: %s', (filePath) => {
    withIndex(({ root, git, write }) => {
      write(filePath, `${requiredSections.join('\n')}\nEdited private narrative`)
      git(['add', filePath])
      expect(checkDocumentationGovernance(root)).toContain(
        `Internal product design prose must remain private: ${filePath}`
      )
    })
  })
  it('rejects changed staged authority and missing staged policy', () => {
    withIndex(({ root, git, write }) => {
      write('.gitmodules', '[submodule "docs"]\npath = docs\nurl = ../wrong-authority\n')
      git(['add', '.gitmodules'])
      git(['update-index', '--force-remove', policyPath])
      expect(checkDocumentationGovernance(root)).toEqual(
        expect.arrayContaining([
          'docs must bind exactly once to the private coder-lulu/hive-code-docs repository',
          'Private document fingerprint policy must be tracked as a regular public file',
          'Private document fingerprint policy is missing, empty or invalid'
        ])
      )
    })
  })
  it('parses stage and path boundaries and rejects malformed index records', () => {
    expect(parseTrackedEntries(`160000 ${'a'.repeat(40)} 0\tdocs\0`)).toEqual([
      { mode: '160000', objectSha: 'a'.repeat(40), stage: 0, path: 'docs' }
    ])
    expect(() => parseTrackedEntries('160000 invalid 0\tdocs\0')).toThrow(
      'Malformed staged Git file entry'
    )
  })
})
