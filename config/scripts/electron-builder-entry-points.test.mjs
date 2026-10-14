import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
const require = createRequire(import.meta.url)
const REPO_ROOT = join(import.meta.dirname, '..', '..')
const MAIN_BUILD_ENTRY_POINTS_PATH = join(REPO_ROOT, 'config', 'build-plugins', 'main-build-entry-points.ts')
const electronBuilderConfig = require('../electron-builder.config.cjs')
const { FileMatcher } = require('app-builder-lib/out/fileMatcher')

describe('unpacked child process entries', () => {
  it('unpacks the replaceable WSL transcript filesystem process entry', async () => {
    const entryFilename = 'wsl-transcript-fs-process-entry.js'
    expect(electronBuilderConfig.asarUnpack).toContain(
      'out/main/wsl-transcript-fs-process-entry.js'
    )

    const entryPoints = await readFile(MAIN_BUILD_ENTRY_POINTS_PATH, 'utf8')
    expect(entryPoints).toMatch(
      new RegExp(`'${entryFilename.replace(/\.js$/, '')}':\\s*resolve\\(`)
    )
  })

  // Why: the CLI runs this entry under ELECTRON_RUN_AS_NODE, which cannot read
  // app.asar, so a packed copy sends every `orca serve` to Electron (#27307).
  it('unpacks the orcad serve-selection entry the CLI runs', async () => {
    const sharedSource = await readFile(
      join(REPO_ROOT, 'src', 'shared', 'orcad-local-serve-selection.ts'),
      'utf8'
    )
    const entryName = sharedSource.match(/ORCAD_LOCAL_SERVE_SELECTION_ENTRY = '([^']+)'/)?.[1]
    expect(entryName).toBeDefined()

    const matcher = new FileMatcher(
      '/app',
      '/dest',
      (value) => value,
      electronBuilderConfig.asarUnpack
    )
    const isUnpacked = matcher.createFilter()
    expect(
      isUnpacked(join('/app', 'out', 'main', `${entryName}.js`), { isDirectory: () => false })
    ).toBe(true)
  })

  // Why: the scanner service is forked with ELECTRON_RUN_AS_NODE, so asar is
  // invisible to it and a packed worker entry fails closed — dropping every
  // OpenCode session in packaged builds while dev stays green. Three legs must
  // agree on the filename, so all three are read rather than hardcoded.
})
