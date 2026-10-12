import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const electronBuilderConfig = require('../electron-builder.config.cjs')
const { FileMatcher, getMainFileMatchers } = require('app-builder-lib/out/fileMatcher')

describe('electron-builder config', () => {
  it.each(['win', 'mac', 'linux'])(
    'excludes local AOCI state and retired service output with the %s production matcher',
    (platform) => {
      const root = process.cwd()
      const [matcher] = getMainFileMatchers(
        root,
        join(root, 'logs/packaging-matcher/destination'),
        (value) => value.replaceAll('${arch}', 'x64'),
        electronBuilderConfig[platform],
        {
          info: {
            projectDir: root,
            buildResourcesDir: 'resources/build',
            config: electronBuilderConfig,
            isPrepackedAppAsar: false,
            debugLogger: { isEnabled: false }
          }
        },
        join(root, '.build/packaging-output'),
        false
      )
      const isPacked = matcher.createFilter()
      for (const directory of [
        '.aoci',
        'out/paperclip-service',
        'out/paperclip-adapter',
        'out/paperclip-runtime',
        'out/managed-pi',
        'out/native-pi'
      ]) {
        expect
          .soft(isPacked(join(root, directory), { isDirectory: () => true }), directory)
          .toBe(false)
      }
      for (const file of [
        '.aoci/baseline.json',
        '.aoci/config.json',
        '.aoci/ledger.jsonl',
        '.aoci/verify_history/result.json',
        'aoci.txt',
        'aoci.code.txt',
        'aoci.meta.txt',
        'AGENTS.md.backup.20261005_205649.f8f60302cb8ed360c247dbc56a894f9a81760a0612aa34ae61c83ab9df463a27',
        'out/paperclip-service/service.mjs',
        'out/paperclip-service/resource-manifest.json',
        'out/native-pi/win32-x64/node.exe',
        'out/managed-pi/linux-x64/agent.cjs'
      ]) {
        expect.soft(isPacked(join(root, file), { isDirectory: () => false }), file).toBe(false)
      }
      for (const file of ['out/main/index.js', 'out/preload/index.js', 'out/renderer/index.html']) {
        expect(isPacked(join(root, file), { isDirectory: () => false }), file).toBe(true)
      }
      for (const retired of [
        'paperclip-service',
        'paperclip-adapter',
        'paperclip-runtime',
        'native-pi',
        'managed-pi'
      ].flatMap((name) => [
        name,
        name.toUpperCase(),
        name.replace(/(^|-)[a-z]/g, (letter) => letter.toUpperCase())
      ])) {
        expect
          .soft(isPacked(join(root, 'out', retired), { isDirectory: () => true }), retired)
          .toBe(false)
        for (const name of [
          'index.js',
          'server.mjs',
          'agent.cjs',
          'index.js.map',
          'server.d.ts',
          'package.json',
          'LICENSE',
          'nested/extensionless'
        ]) {
          const file = `out/${retired}/${name}`
          expect.soft(isPacked(join(root, file), { isDirectory: () => false }), file).toBe(false)
        }
      }
    }
  )

  it.each(['win', 'mac', 'linux'])(
    'does not copy retired service or HiveAI resources on %s',
    (platform) => {
      expect(
        electronBuilderConfig[platform].extraResources.filter((resource) =>
          /paperclip|native-pi|managed-pi/i.test(JSON.stringify(resource))
        )
      ).toEqual([])
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
