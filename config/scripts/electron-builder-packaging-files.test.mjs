import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const electronBuilderConfig = require('../electron-builder.config.cjs')
const { FileMatcher } = require('app-builder-lib/out/fileMatcher')
const { createManagedPiPackResource } = require('../managed-pi-pack-resources.cjs')

describe('electron-builder config', () => {
  it.each(['win32', 'darwin', 'linux'])(
    'excludes all Pack build slices from app.asar while copying only the %s target',
    (platform) => {
      const root = process.cwd()
      const mapping = createManagedPiPackResource(platform)
      const expand = (value) => value.replaceAll('${arch}', 'x64')
      const extra = new FileMatcher(
        join(root, expand(mapping.from)),
        '/resources',
        expand,
        mapping.filter
      )
      const excludes = []
      extra.computeParsedPatterns(excludes, root)
      const app = new FileMatcher(root, '/dest', expand, electronBuilderConfig.files)
      app.prependPattern('**/*')
      app.excludePatterns = excludes
      const isFile = { isDirectory: () => false }
      const packRoot = `out/managed-pi/${platform}-x64`
      expect(
        extra.createFilter()(
          join(root, packRoot, platform === 'win32' ? 'node.exe' : 'node'),
          isFile
        )
      ).toBe(true)
      for (const os of ['win32', 'darwin', 'linux']) {
        for (const arch of ['x64', 'arm64']) {
          for (const file of [
            'pack-index.json',
            os === 'win32' ? 'node.exe' : 'node',
            'agent.cjs',
            'sbom.json'
          ]) {
            expect(
              app.createFilter()(join(root, `out/managed-pi/${os}-${arch}`, file), isFile)
            ).toBe(false)
          }
        }
      }
      expect(app.createFilter()(join(root, 'out/main/managed-pi-pack-product.js'), isFile)).toBe(
        true
      )
      expect(app.createFilter()(join(root, 'out/renderer/index.html'), isFile)).toBe(true)
    }
  )

  it('keeps the packaged app identity aligned with local-build validation', () => {
    expect(electronBuilderConfig.appId).toBe(
      require('../../src/shared/local-build-compatibility-contract.json').appId
    )
  })

  it('excludes repo-only source trees from app.asar', () => {
    expect(electronBuilderConfig.files).toEqual(
      expect.arrayContaining([
        '!src{,/**/*}',
        '!config{,/**/*}',
        '!docs{,/**/*}',
        '!mobile{,/**/*}',
        '!cloud{,/**/*}',
        '!native{,/**/*}',
        '!skills{,/**/*}',
        '!skill-guides{,/**/*}',
        '!skill-stubs{,/**/*}',
        '!resources/skills/**',
        '!tests{,/**/*}',
        '!examples{,/**/*}',
        '!pr-evidence{,/**/*}',
        '!{.claude,.grok,.agents,.codex}{,/**/*}',
        '!Casks{,/**/*}',
        '!{AGENTS.md,CLAUDE.md,DEVELOPING.md,bundle-size-progress.md,ORCHESTRATION_IMPLEMENTATION_CHECKLIST.md,ORCHESTRATION_STRUCTURED_OUTPUT_DESIGN.md}',
        '!out/**/*.test.js',
        '!resources/plugins/launch/**'
      ])
    )
  })

  it('keeps local agent tooling out of app.asar', () => {
    const matcher = new FileMatcher('/app', '/dest', (value) => value, electronBuilderConfig.files)
    matcher.prependPattern('**/*')
    const isPacked = matcher.createFilter()
    const packs = (repoPath) => isPacked(join('/app', repoPath), { isDirectory: () => false })

    for (const toolingPath of [
      '.grok/skills/review-and-submit/review-and-submit/SKILL.md',
      '.claude/skills/review-and-submit/review-and-submit/SKILL.md',
      '.agents/skills/electron/SKILL.md',
      '.codex/sessions/session.json',
      '.client-build.local.json',
      '.anti-slop-plugin/skills/review/SKILL.md',
      '.tmp/p4/material.json',
      '.omx/state/session.json',
      '.local-dev/session.json',
      'test-results/runtime/trace.zip',
      'playwright-report/data/trace.zip',
      'output/artifacts/app.apk',
      '.env.local',
      '.npmrc'
    ]) {
      expect(packs(toolingPath)).toBe(false)
    }
    expect(packs('out/main/index.js')).toBe(true)
  })

  it('excludes root diagnostic and intermediate build trees without excluding runtime names', () => {
    const root = resolve(import.meta.dirname, '..', '..')
    const matcher = new FileMatcher(root, '/dest', (value) => value, electronBuilderConfig.files)
    matcher.prependPattern('**/*')
    const isPacked = matcher.createFilter()

    for (const directory of ['logs', '.build']) {
      expect(isPacked(join(root, directory), { isDirectory: () => true })).toBe(false)
      expect(
        isPacked(join(root, directory, 'profile', 'session.json'), { isDirectory: () => false })
      ).toBe(false)
      expect(
        isPacked(join(root, 'out', 'main', directory, 'index.js'), { isDirectory: () => false })
      ).toBe(true)
    }
  })

  // Why: `files` is an all-negation list, so electron-builder's default `**/*` packs
  // anything without an explicit `!` entry — examples/ landed without one and shipped
  // hostile-panel, the adversarial containment fixture, into 1.4.160-rc.3's app.asar.
  // Drive the real matcher: pinning the pattern string cannot prove it excludes the tree.
  it('keeps authoring examples and cloud operations out of app.asar', () => {
    const matcher = new FileMatcher('/app', '/dest', (value) => value, electronBuilderConfig.files)
    // copyFiles() prepends this itself once the pattern list is all-negation.
    matcher.prependPattern('**/*')
    const isPacked = matcher.createFilter()
    const packs = (repoPath) => isPacked(join('/app', repoPath), { isDirectory: () => false })

    for (const authoringOnly of [
      'cloud/apps/relay/src/index.ts',
      'cloud/infra/terraform/production/main.tf',
      'examples/plugins/hostile-panel/panel.html',
      'examples/plugins/hostile-panel/orca-plugin.json',
      'examples/plugins/hello-orca/main.mjs',
      'examples/plugins/hello-orca/orca-plugin.json'
    ]) {
      expect(packs(authoringOnly)).toBe(false)
    }
    // The negation stays anchored at the app root, so nested `examples` segments still ship.
    expect(packs('out/main/examples/index.js')).toBe(true)
    expect(packs('out/main/cloud/index.js')).toBe(true)
  })

  // Why: out/electron-dev holds `pnpm dev`'s cached Electron.app copies (~270MB per branch).
  // CI never creates it, so only a local package would have hit this -- silently, as bulk.
  it('keeps cached dev Electron bundles out of app.asar', () => {
    const matcher = new FileMatcher('/app', '/dest', (value) => value, electronBuilderConfig.files)
    matcher.prependPattern('**/*')
    const isPacked = matcher.createFilter()
    const packs = (repoPath) => isPacked(join('/app', repoPath), { isDirectory: () => false })

    for (const devBundlePath of [
      'out/electron-dev/1a2b3c4d5e6f/Orca: dev.app/Contents/MacOS/Electron',
      'out/electron-dev/1a2b3c4d5e6f/orca-dev-electron-app.json'
    ]) {
      expect(packs(devBundlePath)).toBe(false)
    }
    // The real build outputs sit beside it under out/ and must still ship.
    expect(packs('out/main/index.js')).toBe(true)
    expect(packs('out/renderer/index.html')).toBe(true)
  })
})
