import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import { findBrokenReadmeLinks, main } from './check-readme-local-links.mjs'

const projectDir = path.resolve(import.meta.dirname, '../..')
const tempDirs = []
function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim()
}
function writeFiles(root, files) {
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = path.join(root, relativePath)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, contents)
  }
}
function makeFixture(files, { untracked = {} } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'hive-readme-links-'))
  tempDirs.push(root)
  git(root, ['init', '--quiet'])
  git(root, ['config', 'user.email', 'readme-links-test@example.com'])
  git(root, ['config', 'user.name', 'README Links Test'])
  git(root, ['config', 'commit.gpgSign', 'false'])
  writeFiles(root, files)
  git(root, ['add', '-A'])
  git(root, ['commit', '--quiet', '-m', 'fixture'])
  writeFiles(root, untracked)
  return root
}
const validReadmes = {
  'README.md': [
    '<img src="resources/build/icon.png" />',
    '<picture><source srcset="resources/onboarding/feature-wall/tile-01.gif 1x, resources/onboarding/feature-wall/tile-01.poster.jpg 2x"><img src="resources/onboarding/feature-wall/tile-01.poster.jpg" /></picture>',
    "<img src='resources/build/icon.png' />",
    '<img src="https://img.shields.io/badge/x-y-z" />',
    '[Contributing](.github/CONTRIBUTING.md) [Private docs](https://github.com/coder-lulu/hive-code-docs) [Top](#top)',
    '![hero](resources/hero%20image.jpg "Hero")'
  ].join('\n'),
  'resources/build/icon.png': 'png',
  'resources/onboarding/feature-wall/tile-01.gif': 'gif',
  'resources/onboarding/feature-wall/tile-01.poster.jpg': 'jpg',
  'resources/hero image.jpg': 'jpg',
  '.github/CONTRIBUTING.md': 'contributing',
  LICENSE: 'mit'
}
afterEach(() => {
  vi.restoreAllMocks()
  while (tempDirs.length) {
    rmSync(tempDirs.pop(), { force: true, recursive: true })
  }
})

describe('public README local link check', () => {
  it('accepts a public-only checkout with no private docs directory', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(main(makeFixture(validReadmes))).toBe(0)
  })
  it('accepts local links in every supported shape', () => {
    expect(findBrokenReadmeLinks(makeFixture(validReadmes))).toEqual([])
  })
  it('does not inspect initialized private translated READMEs', () => {
    const root = makeFixture(validReadmes, {
      untracked: { 'docs/readme/README.ja.md': '<img src="private-missing.png" />' }
    })
    expect(findBrokenReadmeLinks(root)).toEqual([])
  })
  it('accepts a tracked gitlink itself but rejects links into private submodule contents', () => {
    const root = makeFixture({
      ...validReadmes,
      'README.md': '[Docs](docs) [Private page](docs/engineering/product-design.md)'
    })
    git(root, [
      'update-index',
      '--add',
      '--cacheinfo',
      `160000,${git(root, ['rev-parse', 'HEAD'])},docs`
    ])
    expect(findBrokenReadmeLinks(root)).toEqual([
      {
        readme: 'README.md',
        target: 'docs/engineering/product-design.md',
        resolved: 'docs/engineering/product-design.md'
      }
    ])
  })
  it('checks tracked media outside the detector sparse checkout', () => {
    const root = makeFixture(validReadmes)
    const workflow = parse(readFileSync(path.join(projectDir, '.github/workflows/pr.yml'), 'utf8'))
    const checkout = workflow.jobs.code_paths.steps.find((step) =>
      step.uses?.startsWith('actions/checkout@')
    )
    expect(checkout.with['sparse-checkout-cone-mode']).toBe(false)
    git(root, [
      'sparse-checkout',
      'set',
      '--no-cone',
      ...checkout.with['sparse-checkout'].trim().split('\n')
    ])
    expect(existsSync(path.join(root, 'resources/build/icon.png'))).toBe(false)
    expect(findBrokenReadmeLinks(root)).toEqual([])
    git(root, ['update-index', '--force-remove', 'resources/build/icon.png'])
    expect(findBrokenReadmeLinks(root).map((link) => link.resolved)).toEqual([
      'resources/build/icon.png'
    ])
  })
  it('reports deleted public media and exits 1', () => {
    const { 'resources/onboarding/feature-wall/tile-01.gif': _gif, ...files } = validReadmes
    const root = makeFixture(files)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(findBrokenReadmeLinks(root)).toEqual([
      {
        readme: 'README.md',
        target: 'resources/onboarding/feature-wall/tile-01.gif',
        resolved: 'resources/onboarding/feature-wall/tile-01.gif'
      }
    ])
    expect(main(root)).toBe(1)
  })
  it('reports referenced public files present on disk but absent from the index', () => {
    const { 'resources/build/icon.png': icon, ...files } = validReadmes
    const root = makeFixture(files, { untracked: { 'resources/build/icon.png': icon } })
    expect(findBrokenReadmeLinks(root).map((link) => link.resolved)).toEqual([
      'resources/build/icon.png'
    ])
  })
  it('rejects repository escape from the public root README', () => {
    const root = makeFixture({ ...validReadmes, 'README.md': '<img src="../outside.png" />' })
    expect(findBrokenReadmeLinks(root)).toEqual([
      { readme: 'README.md', target: '../outside.png', resolved: null }
    ])
  })
  it('reports missing targets in single-quoted attributes', () => {
    const root = makeFixture({
      ...validReadmes,
      'README.md': `${validReadmes['README.md']}\n<img src='resources/missing.gif' />`
    })
    expect(findBrokenReadmeLinks(root)).toEqual([
      { readme: 'README.md', target: 'resources/missing.gif', resolved: 'resources/missing.gif' }
    ])
  })

  // Why: a single-quoted attribute is valid HTML and GitHub renders it, so a parser
  // that only reads double quotes would pass a README with a broken image.
  it('reports a missing target in a single-quoted attribute', () => {
    const files = {
      ...validReadmes,
      'README.md': `${validReadmes['README.md']}\n<img src='docs/assets/missing.gif' />`
    }

    expect(findBrokenReadmeLinks(makeFixture(files))).toEqual([
      {
        readme: 'README.md',
        target: 'docs/assets/missing.gif',
        resolved: 'docs/assets/missing.gif'
      }
    ])
  })

  // Docs-only diffs skip preflight, so the detector must check README links.
  it('runs on every PR through the ungated detector and in the lint script', () => {
    const { scripts } = JSON.parse(readFileSync(path.join(projectDir, 'package.json'), 'utf8'))
    const workflow = parse(readFileSync(path.join(projectDir, '.github/workflows/pr.yml'), 'utf8'))
    const job = workflow.jobs.code_paths
    const step = job.steps.find((candidate) => candidate.name === 'Check README local links')
    expect(job.if).toBeUndefined()
    expect(job.needs).toBeUndefined()
    expect(step.if).toBeUndefined()
    expect(step.run).toBe('node config/scripts/check-readme-local-links.mjs')
    expect(scripts['check:readme-local-links']).toBe(
      'node config/scripts/check-readme-local-links.mjs'
    )
    expect(scripts.lint).toContain('pnpm run check:readme-local-links')
  })
})
