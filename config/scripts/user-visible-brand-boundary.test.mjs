import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  collectBrandCandidatesFromSource,
  collectRendererBrandCandidates
} = require('./user-visible-brand-candidates.cjs')
const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const upstreamVisibleBrandPattern = /\b(?:ORCA|Orca)\b/
const upstreamPublicLinkPattern =
  /(?:app\.orca\.dev|onorca\.dev|github\.com\/stablyai\/orca|discord\.gg\/fzjDKHxv8Q|x\.com\/orca_build)/i
const legacyVisibleProtocolPattern = /orca:\/\/(?:pair|skills\/share)/i
const localeCatalogFiles = readdirSync(
  path.join(repoRoot, 'src', 'renderer', 'src', 'i18n', 'locales')
)
  .filter((entry) => entry.endsWith('.json'))
  .map((entry) => path.join(repoRoot, 'src', 'renderer', 'src', 'i18n', 'locales', entry))
const userVisibleSharedFiles = [
  path.join(repoRoot, 'src', 'shared', 'agent-session-write-notice-copy.ts'),
  path.join(repoRoot, 'src', 'shared', 'agent-session-failure-words.ts'),
  path.join(repoRoot, 'src', 'shared', 'feature-wall-tiles.ts'),
  path.join(repoRoot, 'src', 'shared', 'feature-wall-workflows.ts'),
  path.join(repoRoot, 'src', 'shared', 'feature-tips.ts'),
  path.join(repoRoot, 'src', 'shared', 'agents-orchestration-steps.ts'),
  path.join(repoRoot, 'src', 'shared', 'client-environment-info.ts'),
  path.join(repoRoot, 'src', 'shared', 'orchestration-rpc-contract.ts'),
  path.join(repoRoot, 'src', 'shared', 'source-control-ai-action-variables.ts'),
  path.join(repoRoot, 'src', 'shared', 'workbench-steps.ts')
]
function sourceFilesUnder(root) {
  const files = []
  for (const entry of readdirSync(root)) {
    const absolutePath = path.join(root, entry)
    const stat = statSync(absolutePath)
    if (stat.isDirectory()) {
      if (entry === '__tests__' || entry === '__fixtures__') {
        continue
      }
      files.push(...sourceFilesUnder(absolutePath))
      continue
    }
    if (
      !/\.[jt]sx?$/.test(entry) ||
      /\.test\.[jt]sx?$/.test(entry) ||
      /(?:test-fixtures?|test-harness)\.[jt]sx?$/.test(entry)
    ) {
      continue
    }
    files.push(absolutePath)
  }
  return files
}

function collectVisibleBrandLeaks(filePath) {
  if (filePath.endsWith(`${path.sep}mobile${path.sep}src${path.sep}product-brand.ts`)) {
    return []
  }
  const source = readFileSync(filePath, 'utf8')
  const leaks = []
  let insideBlockComment = false
  let productNameAdapterDepth = 0
  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const trimmed = rawLine.trim()
    if (insideBlockComment) {
      if (trimmed.includes('*/')) {
        insideBlockComment = false
      }
      continue
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) {
        insideBlockComment = true
      }
      continue
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
      continue
    }

    const code = rawLine
      .split('//', 1)[0]
      .replaceAll('ORCA.YAML', '')
      .replaceAll('ORCA_CLOUD_API_URL', '')
    const adapterIndices = ['productNameText(', 'translate(', 'applyProductBranding(']
      .map((name) => code.indexOf(name))
      .filter((index) => index >= 0)
    const adapterIndex = adapterIndices.length > 0 ? Math.min(...adapterIndices) : -1
    const isInsideProductNameAdapter = productNameAdapterDepth > 0 || adapterIndex >= 0
    const adapterSlice = adapterIndex >= 0 ? code.slice(adapterIndex) : code
    if (isInsideProductNameAdapter) {
      productNameAdapterDepth +=
        [...adapterSlice].filter((char) => char === '(').length -
        [...adapterSlice].filter((char) => char === ')').length
      productNameAdapterDepth = Math.max(0, productNameAdapterDepth)
    }
    if (!isInsideProductNameAdapter && upstreamVisibleBrandPattern.test(code)) {
      leaks.push(
        `${path.relative(repoRoot, filePath).replaceAll('\\', '/')}:${index + 1}:${trimmed}`
      )
    }
  }
  return leaks
}

describe('user-visible brand boundary', () => {
  it('only exempts direct static values inside product-brand adapters', () => {
    const fixturePath = path.join(repoRoot, 'dynamic-brand-adapter-fixture.ts')
    const dynamicCases = [
      'applyProductBranding(`Orca failed for ${userText}`)',
      "applyProductBranding('Orca failed ' + userText)",
      "applyProductBranding(condition ? 'Orca failed' : userText)",
      "applyProductBranding(['Orca failed', userText].join(' '))"
    ]
    for (const source of dynamicCases) {
      expect(collectBrandCandidatesFromSource(source, fixturePath, repoRoot)).toEqual([
        expect.stringMatching(/^dynamic-brand-adapter-fixture\.ts:1:Orca failed/)
      ])
    }
    expect(
      collectBrandCandidatesFromSource(
        "applyProductBranding('Orca failed for a static reason')",
        fixturePath,
        repoRoot
      )
    ).toEqual([])
    expect(
      collectBrandCandidatesFromSource(
        "translate('example.key', 'Orca failed for a static reason')",
        fixturePath,
        repoRoot
      )
    ).toEqual([])
    expect(
      collectBrandCandidatesFromSource(
        "translate('example.key', 'Orca failed ' + userText)",
        fixturePath,
        repoRoot
      )
    ).toEqual(['dynamic-brand-adapter-fixture.ts:1:Orca failed'])

    for (const source of [
      'applyProductBranding(error.message)',
      'applyProductBranding(status.message)',
      'applyProductBranding(message)',
      'applyProductCliBranding(value)'
    ]) {
      expect(collectBrandCandidatesFromSource(source, fixturePath, repoRoot)).toEqual([
        expect.stringMatching(/dynamic-brand-adapter-fixture\.ts:1:.*dynamic value/)
      ])
    }

    const rendererI18nPath = path.join(repoRoot, 'src', 'renderer', 'src', 'i18n', 'i18n.ts')
    expect(
      collectBrandCandidatesFromSource(
        'function translate(fallback) { return applyProductCliBranding(fallback) }',
        rendererI18nPath,
        repoRoot
      )
    ).toEqual([])
    expect(
      collectBrandCandidatesFromSource(
        'function translate(fallback, value) { return applyProductCliBranding(value) }',
        rendererI18nPath,
        repoRoot
      )
    ).toEqual([expect.stringMatching(/src\/renderer\/src\/i18n\/i18n\.ts:1:.*dynamic value/)])
  })

  it('treats backend error properties and browser tab commands as visible copy', () => {
    const fixturePath = path.join(repoRoot, 'backend-brand-boundary-fixture.ts')
    expect(
      collectBrandCandidatesFromSource(
        'const result = { error: `plugin is blocked by Orca: ${blockedReason}` }',
        fixturePath,
        repoRoot,
        { backendUserVisibleContextOnly: true }
      )
    ).toEqual([expect.stringMatching(/backend-brand-boundary-fixture\.ts:1:plugin is blocked/)])
    expect(
      collectBrandCandidatesFromSource(
        'throw new Error("Run \'orca tab list\' to recover.")',
        fixturePath,
        repoRoot,
        { backendUserVisibleContextOnly: true }
      )
    ).toEqual([expect.stringMatching(/backend-brand-boundary-fixture\.ts:1:Run 'orca tab list'/)])
  })

  it('does not ship standalone upstream product names in mobile production copy', () => {
    const roots = [path.join(repoRoot, 'mobile', 'app'), path.join(repoRoot, 'mobile', 'src')]
    const leaks = roots.flatMap((root) => sourceFilesUnder(root).flatMap(collectVisibleBrandLeaks))

    expect(leaks).toEqual([])
  })

  it('does not expose upstream public links from product UI code', () => {
    const roots = [
      path.join(repoRoot, 'src', 'renderer', 'src'),
      path.join(repoRoot, 'mobile', 'app'),
      path.join(repoRoot, 'mobile', 'src')
    ]
    const leaks = [
      ...roots.flatMap(sourceFilesUnder),
      ...localeCatalogFiles,
      ...userVisibleSharedFiles
    ]
      .filter((filePath) => !filePath.includes('test-fakes'))
      .flatMap((filePath) =>
        readFileSync(filePath, 'utf8')
          .split(/\r?\n/)
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => upstreamPublicLinkPattern.test(line))
          .map(
            ({ line, index }) =>
              `${path.relative(repoRoot, filePath).replaceAll('\\', '/')}:${index + 1}:${line.trim()}`
          )
      )

    expect(leaks).toEqual([])
  }, 30_000)

  it('does not advertise legacy product protocols in UI copy or locale catalogs', () => {
    const roots = [
      path.join(repoRoot, 'src', 'renderer', 'src'),
      path.join(repoRoot, 'mobile', 'app'),
      path.join(repoRoot, 'mobile', 'src')
    ]
    const leaks = [...roots.flatMap(sourceFilesUnder), ...localeCatalogFiles]
      .filter((filePath) => !filePath.includes('test-fakes'))
      .flatMap((filePath) =>
        readFileSync(filePath, 'utf8')
          .split(/\r?\n/)
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => legacyVisibleProtocolPattern.test(line))
          .map(
            ({ line, index }) =>
              `${path.relative(repoRoot, filePath).replaceAll('\\', '/')}:${index + 1}:${line.trim()}`
          )
      )

    expect(leaks).toEqual([])
  }, 30_000)

  it('does not ship standalone upstream product names in desktop production copy', () => {
    const rendererFiles = sourceFilesUnder(path.join(repoRoot, 'src', 'renderer', 'src'))
    // This file is generated from skill guides, whose source/manifest parity has
    // its own release gate; parsing the embedded copies creates duplicate noise.
    const cliFiles = sourceFilesUnder(path.join(repoRoot, 'src', 'cli')).filter(
      (filePath) => !filePath.endsWith(`${path.sep}bundled-skill-guides.ts`)
    )
    const sharedVisibleFileSet = new Set(userVisibleSharedFiles)
    const sharedFiles = sourceFilesUnder(path.join(repoRoot, 'src', 'shared'))
    const backendContextFiles = [
      ...sourceFilesUnder(path.join(repoRoot, 'src', 'main')),
      ...sharedFiles.filter((filePath) => !sharedVisibleFileSet.has(filePath))
    ]
    const leaks = [
      ...rendererFiles.flatMap((filePath) => collectRendererBrandCandidates(filePath, repoRoot)),
      ...cliFiles.flatMap((filePath) => collectRendererBrandCandidates(filePath, repoRoot)),
      ...userVisibleSharedFiles.flatMap((filePath) =>
        collectRendererBrandCandidates(filePath, repoRoot)
      ),
      ...backendContextFiles.flatMap((filePath) =>
        collectRendererBrandCandidates(filePath, repoRoot, {
          backendUserVisibleContextOnly: true
        })
      )
    ]

    expect(leaks).toEqual([])
  }, 90_000)
})
