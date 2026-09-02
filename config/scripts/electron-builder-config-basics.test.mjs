import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const electronBuilderConfig = require('../electron-builder.config.cjs')
const { FileMatcher } = require('app-builder-lib/out/fileMatcher')

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
        '!mobile{,/**/*}',
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
})
