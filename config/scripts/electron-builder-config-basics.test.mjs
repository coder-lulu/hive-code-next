import { existsSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const electronBuilderConfig = require('../electron-builder.config.cjs')
const { copyFiles, FileMatcher } = require('app-builder-lib/out/fileMatcher')

const expectedPackagedMetadata = {
  name: 'hivecode',
  productName: 'HiveCode',
  description: 'HiveCode',
  author: { name: 'HiveCode' }
}

function createPackMatcher() {
  const matcher = new FileMatcher('/app', '/dest', (value) => value, electronBuilderConfig.files)
  matcher.prependPattern('**/*')
  const isPacked = matcher.createFilter()
  return (repoPath) => isPacked(join('/app', repoPath), { isDirectory: () => false })
}

describe('electron-builder config basics', () => {
  it('replaces upstream npm metadata in packaged application identity', () => {
    expect(electronBuilderConfig.extraMetadata).toEqual(expectedPackagedMetadata)
  })

  it('uses the branded product name for Windows shell entries', () => {
    expect(electronBuilderConfig.productName).toBe('HiveCode')
    expect(electronBuilderConfig.win.executableName).toBe('HiveCode')
    expect(electronBuilderConfig.nsis).toMatchObject({
      artifactName: 'hivecode-windows-setup.${ext}',
      shortcutName: '${productName}',
      uninstallDisplayName: '${productName}',
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      runAfterFinish: false,
      license: 'installer-license.txt'
    })
  })

  it('keeps the Windows installer notice beside the NSIS build resources', async () => {
    const notice = await readFile(
      join(process.cwd(), 'resources', 'build', 'installer-license.txt'),
      'utf8'
    )
    const normalizedNotice = notice.replace(/\r\n/g, '\n')
    expect(normalizedNotice).toContain('HiveCode 安装许可、隐私与用户须知')
    expect(normalizedNotice).toContain('设置 > 隐私与遥测')
    expect(normalizedNotice).toContain('Settings >\nPrivacy & Telemetry')
    expect(normalizedNotice).not.toMatch(/onorca\.dev|github\.com\/stablyai\/orca/i)
    expect(normalizedNotice).toContain('正式商业发布前，请由法务审核')
  })

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
        '!resources/readme{,/**/*}',
        '!mobile{,/**/*}',
        '!native{,/**/*}',
        '!skills{,/**/*}',
        '!skill-guides{,/**/*}',
        '!skill-stubs{,/**/*}',
        '!resources/skills/**',
        '!tests{,/**/*}',
        '!examples{,/**/*}',
        '!pr-evidence{,/**/*}',
        '!notes{,/**/*}',
        '!{.claude,.grok,.agents,.codex}{,/**/*}',
        '!Casks{,/**/*}',
        '!{AGENTS.md,CLAUDE.md,DEVELOPING.md,bundle-size-progress.md,ORCHESTRATION_IMPLEMENTATION_CHECKLIST.md,ORCHESTRATION_STRUCTURED_OUTPUT_DESIGN.md}',
        '!out/**/*.test.js',
        '!resources/plugins/launch/**'
      ])
    )
  })

  it('keeps local agent tooling out of app.asar', () => {
    const packs = createPackMatcher()
    for (const toolingPath of [
      '.grok/skills/review-and-submit/review-and-submit/SKILL.md',
      '.claude/skills/review-and-submit/review-and-submit/SKILL.md',
      '.agents/skills/electron/SKILL.md',
      '.codex/sessions/session.json'
    ]) {
      expect(packs(toolingPath)).toBe(false)
    }
    expect(packs('out/main/index.js')).toBe(true)
  })

  it('keeps plugin authoring examples out of app.asar', () => {
    const packs = createPackMatcher()
    for (const authoringOnly of [
      'examples/plugins/hostile-panel/panel.html',
      'examples/plugins/hostile-panel/orca-plugin.json',
      'examples/plugins/hello-orca/main.mjs',
      'examples/plugins/hello-orca/orca-plugin.json'
    ]) {
      expect(packs(authoringOnly)).toBe(false)
    }
    expect(packs('out/main/examples/index.js')).toBe(true)
  })

  it('keeps cached dev Electron bundles out of app.asar', () => {
    const packs = createPackMatcher()
    for (const devBundlePath of [
      'out/electron-dev/1a2b3c4d5e6f/Orca: dev.app/Contents/MacOS/Electron',
      'out/electron-dev/1a2b3c4d5e6f/orca-dev-electron-app.json'
    ]) {
      expect(packs(devBundlePath)).toBe(false)
    }
    expect(packs('out/main/index.js')).toBe(true)
    expect(packs('out/renderer/index.html')).toBe(true)
  })
  it.each(['file', 'directory'])('keeps a root notes %s out of app.asar', async (kind) => {
    const root = await mkdtemp(join(tmpdir(), 'orca-packaging-notes-'))
    const source = join(root, 'app')
    const destination = join(root, 'selected')
    const runtimePaths = [
      'package.json',
      'out/main/index.js',
      'out/renderer/index.html',
      'out/cli/index.js',
      'out/shared/index.js',
      'out/main/notes/index.js',
      'out/renderer/assets/notes/help.md',
      'resources/notes/help.md',
      'notes.txt'
    ]
    const notesPaths =
      kind === 'file'
        ? ['notes']
        : [
            'notes/build.log',
            'notes/installed-orca-backup/Orca.exe',
            'notes/installed-orca-backup/resources/app.asar',
            'notes/orca-windows-setup.exe',
            'notes/.recovery/state.json'
          ]
    try {
      for (const fixturePath of [...runtimePaths, ...notesPaths]) {
        const file = join(source, fixturePath)
        await mkdir(dirname(file), { recursive: true })
        await writeFile(file, 'synthetic fixture\n')
      }
      if (kind === 'directory') {
        await mkdir(join(source, 'notes', 'empty'))
      }
      const matcher = new FileMatcher(
        source,
        destination,
        (value) => value,
        electronBuilderConfig.files
      )
      // copyFiles adds the default include and prunes excluded directories during traversal.
      await copyFiles([matcher])
      for (const runtimePath of runtimePaths) {
        expect(await readFile(join(destination, runtimePath), 'utf8')).toBe('synthetic fixture\n')
      }
      const isPacked = matcher.createFilter()
      for (const notesPath of new Set(['notes', ...notesPaths])) {
        const file = join(source, notesPath)
        expect(isPacked(file, await lstat(file)), notesPath).toBe(false)
      }
      expect(existsSync(join(destination, 'notes'))).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
