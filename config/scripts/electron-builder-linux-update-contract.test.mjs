import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const electronBuilderConfig = require('../electron-builder.config.cjs')

// Why: .deb/.rpm recovery depends on app-builder-lib's resources/package-type marker.
describe('linux root-package update recovery contract', () => {
  const MARKER_TARGETS = new Set(['deb', 'rpm', 'pacman'])
  const RECOVERABLE_TARGETS = new Set(['deb', 'rpm'])
  const linuxTargets = electronBuilderConfig.linux.target.map((entry) =>
    typeof entry === 'string' ? entry : entry.target
  )

  it('still ships an AppImage plus at least one root-package target', () => {
    expect(linuxTargets).toContain('AppImage')
    expect(linuxTargets.some((target) => MARKER_TARGETS.has(target))).toBe(true)
  })

  it('ships no root-package target the recovery path cannot recover', () => {
    const unrecoverable = linuxTargets.filter(
      (target) => MARKER_TARGETS.has(target) && !RECOVERABLE_TARGETS.has(target)
    )
    expect(unrecoverable).toEqual([])
  })

  it('accepts exactly the markers electron-updater maps to a root-package updater', async () => {
    const source = await readFile(
      new URL('../../src/main/linux-update-package-type.ts', import.meta.url),
      'utf8'
    )
    for (const target of linuxTargets.filter((entry) => RECOVERABLE_TARGETS.has(entry))) {
      expect(source).toContain(`value === '${target}'`)
    }
  })
})
