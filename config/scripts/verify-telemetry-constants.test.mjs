import { createPackage } from '@electron/asar'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { describeProcessFailure, runProcessSync } from './script-child-process.mjs'

const directories = []
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

async function packaged(mainBundles) {
  const fixtureRoot = join(process.cwd(), 'logs', 'packaged-service-tests')
  mkdirSync(fixtureRoot, { recursive: true })
  const root = mkdtempSync(join(fixtureRoot, 'package-'))
  directories.push(root)
  for (const [index, content] of mainBundles.entries()) {
    const source = join(root, `source-${index}`)
    mkdirSync(join(source, 'out/main'), { recursive: true })
    writeFileSync(join(source, 'out/main/index.js'), content)
    const resources = join(root, 'dist', `arch-${index}`, 'resources')
    mkdirSync(resources, { recursive: true })
    await createPackage(source, join(resources, 'app.asar'))
  }
  return join(root, 'dist')
}

function verify(dist) {
  return runProcessSync({
    program: process.execPath,
    args: [resolve('config/scripts/verify-telemetry-constants.mjs'), dist],
    timeoutMs: 30_000
  })
}

describe('packaged disabled product services', () => {
  it('checks every architecture payload without requiring a foreign telemetry key', async () => {
    const result = verify(
      await packaged([
        'const BUILD_IDENTITY = "rc"; const WRITE_KEY = null;',
        'var a = "rc", b = null;'
      ])
    )
    expect(result.code, describeProcessFailure(result)).toBe(0)
    expect(result.stdout).toContain('verified across 2 packaged payload(s)')
  })

  it.each([
    'var a = "rc", b = "phc_foreign";',
    'const endpoint = "https://www.onorca.dev/diagnostics/token";'
  ])(
    'refuses a stale foreign service literal in the second packaged architecture',
    async (bundle) => {
      const result = verify(await packaged(['const WRITE_KEY = null;', bundle]))
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('disabled product services contain foreign build credentials')
    }
  )

  it('refuses a payload with no application JavaScript rather than treating absence as disabled', async () => {
    const dist = await packaged(['const WRITE_KEY = null;'])
    const source = join(directories.at(-1), 'empty-source')
    mkdirSync(source)
    writeFileSync(join(source, 'package.json'), '{}')
    await createPackage(source, join(dist, 'arch-0', 'resources', 'app.asar'))
    const result = verify(dist)
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('no .js files found under out/main/')
  })
})
