import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runProcess } from '@orca/process-host'
import { expect, it } from 'vitest'
import { prebuildCompileGypi } from './orcad-prebuild-slot-contents.mjs'

const require = createRequire(import.meta.url)
const gypLibrary = join(dirname(require.resolve('node-gyp/package.json')), 'gyp', 'pylib')
const evaluate = `
import json, sys
from types import SimpleNamespace
sys.path.insert(0, sys.argv[1])
import gyp
from gyp.xcode_emulation import XcodeSettings
_, _, targets, _ = gyp.Load(
    ['binding.gyp'], 'gypd',
    {'OS': sys.argv[2], 'target_arch': sys.argv[3]},
    ['prebuild-compile.gypi', 'common.gypi'], '.',
    {'options': SimpleNamespace(generator_output=None, toplevel_dir='.'),
     'parallel': False, 'root_targets': None})
target = next(iter(targets.values()))
print(json.dumps({'config': target['configurations']['Release'],
                  'flags': XcodeSettings(target).GetCflagsCC('Release')}))
`

async function compileSettings(platform, arch, compileGypi) {
  const directory = mkdtempSync(join(tmpdir(), 'orcad-macos-gyp-'))
  try {
    writeFileSync(join(directory, 'prebuild-compile.gypi'), compileGypi)
    // Node's later common.gypi disables exceptions in an early macOS condition.
    writeFileSync(
      join(directory, 'common.gypi'),
      JSON.stringify({
        target_defaults: {
          conditions: [['OS=="mac"', { xcode_settings: { GCC_ENABLE_CPP_EXCEPTIONS: 'NO' } }]]
        }
      })
    )
    writeFileSync(
      join(directory, 'binding.gyp'),
      JSON.stringify({
        targets: [{ target_name: 'pty', type: 'loadable_module', configurations: { Release: {} } }]
      })
    )
    const result = await runProcess({
      program: process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
      args: ['-B', '-c', evaluate, gypLibrary, platform, arch],
      cwd: directory
    })
    expect(result.timedOut).toBe(false)
    expect(result.code, result.stderr).toBe(0)
    return JSON.parse(result.stdout)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

it.each(['x64', 'arm64'])('keeps macOS %s exceptions enabled after Node defaults', async (arch) => {
  const result = await compileSettings('mac', arch, prebuildCompileGypi())
  expect(result.config.xcode_settings.GCC_ENABLE_CPP_EXCEPTIONS).toBe('YES')
  expect(result.flags).not.toContain('-fno-exceptions')
  expect(result.flags).toContain('-std=gnu++20')
  expect(result.flags).toContain('-stdlib=libc++')
  expect(result.config.defines).toContain('NAPI_VERSION=8')
})

it('detects early exception settings being overridden by Node defaults', async () => {
  const early = JSON.parse(prebuildCompileGypi())
  delete early.target_defaults.target_conditions
  early.target_defaults.conditions[0][1].xcode_settings.GCC_ENABLE_CPP_EXCEPTIONS = 'YES'
  const result = await compileSettings('mac', 'arm64', JSON.stringify(early))
  expect(result.config.xcode_settings.GCC_ENABLE_CPP_EXCEPTIONS).toBe('NO')
  expect(result.flags).toContain('-fno-exceptions')
})

it('retains Linux static runtime linkage without macOS flags', async () => {
  const result = await compileSettings(
    'linux',
    'x64',
    prebuildCompileGypi({ staticCxxRuntime: true })
  )
  expect(result.config.ldflags).toEqual(['-static-libstdc++', '-static-libgcc'])
  expect(result.config.defines).toContain('NAPI_VERSION=8')
  expect(result.config.xcode_settings).toBeUndefined()
  expect(result.flags).toEqual([])
})
