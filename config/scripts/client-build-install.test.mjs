import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it, expect } from 'vitest'
import { hasBuildToolEntrypoints } from './client-build-install.mjs'

it('rejects an installed package whose declared entry file is missing', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'hive-build-entry-'))
  try {
    const directory = join(cwd, 'node_modules/uuid')
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      join(directory, 'package.json'),
      JSON.stringify({ name: 'uuid', main: './dist/cjs/index.js' })
    )
    expect(hasBuildToolEntrypoints(cwd, ['uuid'])).toBe(false)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

it('accepts a complete package without executing the build tool', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'hive-build-entry-'))
  try {
    const directory = join(cwd, 'node_modules/uuid/dist/cjs')
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      join(cwd, 'node_modules/uuid/package.json'),
      JSON.stringify({ name: 'uuid', main: './dist/cjs/index.js' })
    )
    writeFileSync(join(directory, 'index.js'), 'throw new Error("must not execute")')
    expect(hasBuildToolEntrypoints(cwd, ['uuid'])).toBe(true)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
