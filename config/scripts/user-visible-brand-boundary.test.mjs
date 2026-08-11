import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { collectRendererBrandCandidates } = require('./user-visible-brand-candidates.cjs')
const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const upstreamVisibleBrandPattern = /\b(?:ORCA|Orca)\b/
const upstreamPublicLinkPattern =
  /(?:onorca\.dev|github\.com\/stablyai\/orca|discord\.gg\/fzjDKHxv8Q|x\.com\/orca_build)/i
const userVisibleSharedFiles = [
  path.join(repoRoot, 'src', 'shared', 'feature-wall-tiles.ts'),
  path.join(repoRoot, 'src', 'shared', 'feature-wall-workflows.ts'),
  path.join(repoRoot, 'src', 'shared', 'feature-tips.ts'),
  path.join(repoRoot, 'src', 'shared', 'agents-orchestration-steps.ts'),
  path.join(repoRoot, 'src', 'shared', 'orchestration-rpc-contract.ts'),
  path.join(repoRoot, 'src', 'shared', 'source-control-ai-action-variables.ts'),
  path.join(repoRoot, 'src', 'shared', 'workbench-steps.ts')
]
const mainBrandSurfaceFiles = [
  'src/main/app-icon.ts',
  'src/main/attribution/terminal-attribution.ts',
  'src/main/codex/codex-app-server-session.ts',
  'src/main/i18n/main-i18n.ts',
  'src/main/index.ts',
  'src/main/ipc/notification-options.ts',
  'src/main/ipc/notifications.ts',
  'src/main/automations/run-target-resolution.ts',
  'src/main/startup/appimage-cli-redirect.ts',
  'src/main/startup/packaged-cli-entry-redirect.ts',
  'src/main/startup/single-instance-lock.ts',
  'src/main/tray/system-tray.ts',
  'src/main/window/createMainWindow.ts',
  'src/main/window/dashboard-popout-window.ts'
].map((relativePath) => path.join(repoRoot, relativePath))

function sourceFilesUnder(root) {
  const files = []
  for (const entry of readdirSync(root)) {
    const absolutePath = path.join(root, entry)
    const stat = statSync(absolutePath)
    if (stat.isDirectory()) {
      if (entry === '__tests__') {
        continue
      }
      files.push(...sourceFilesUnder(absolutePath))
      continue
    }
    if (!/\.[jt]sx?$/.test(entry) || /\.test\.[jt]sx?$/.test(entry)) {
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
    const leaks = [...roots.flatMap(sourceFilesUnder), ...userVisibleSharedFiles]
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
  })

  it('does not ship standalone upstream product names in desktop production copy', () => {
    const roots = [path.join(repoRoot, 'src', 'renderer', 'src')]
    const leaks = [
      ...roots.flatMap((root) =>
        sourceFilesUnder(root).flatMap((filePath) =>
          collectRendererBrandCandidates(filePath, repoRoot)
        )
      ),
      ...userVisibleSharedFiles.flatMap((filePath) =>
        collectRendererBrandCandidates(filePath, repoRoot)
      ),
      ...mainBrandSurfaceFiles.flatMap((filePath) =>
        collectRendererBrandCandidates(filePath, repoRoot)
      )
    ]

    expect(leaks).toEqual([])
  }, 30_000)
})
