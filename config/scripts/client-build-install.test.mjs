import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { it, expect, vi } from 'vitest'
import { stringify } from 'yaml'
import { sha256 } from './client-build-contract.mjs'
import {
  canReuseInstalledDependencies,
  hasBuildToolEntrypoints,
  requireTargetDependencies,
  prepareTargetDependencies
} from './client-build-install.mjs'

function withInstalledDependencies(run, target = 'windows-x64') {
  const fixtures = resolve(
    import.meta.dirname,
    '../../logs/all-platform-build/dependency-reuse/fixtures'
  )
  mkdirSync(fixtures, { recursive: true })
  const root = mkdtempSync(join(fixtures, 'installed-'))
  const mobile = target === 'android' || target === 'ios'
  const cwd = mobile ? join(root, 'mobile') : root
  const patch = 'diff --git a/index.js b/index.js\n+module.exports = 1\n'
  const dependencies = {
    'hive-local-probe': 'file:./native',
    'node-pty': '1.1.0',
    ...(mobile ? { '@expo/cli': '55.0.0', '@expo/prebuild-config': '55.0.0', uuid: '11.1.1' } : {})
  }
  const pkg = { name: 'hive-build-reuse-fixture', version: '1.0.0', dependencies }
  const lock = {
    lockfileVersion: '9.0',
    settings: { autoInstallPeers: true, excludeLinksFromLockfile: false },
    patchedDependencies: { 'node-pty@1.1.0': sha256(patch) },
    importers: {
      '.': {
        dependencies: Object.fromEntries(
          Object.entries(dependencies).map(([name, specifier]) => [
            name,
            { specifier, version: name === 'hive-local-probe' ? 'file:native' : specifier }
          ])
        )
      }
    },
    packages: { 'node-pty@1.1.0': { resolution: { integrity: 'sha512-fixture' } } },
    snapshots: { 'node-pty@1.1.0': {}, 'hive-local-probe@file:native': {} }
  }
  const metadata = { nodeLinker: mobile ? 'hoisted' : 'isolated', packageManager: 'pnpm@12.0.0' }
  const write = (file, contents) => {
    mkdirSync(resolve(cwd, file, '..'), { recursive: true })
    writeFileSync(join(cwd, file), contents)
  }
  const writeLocks = (installed = lock) => {
    // pnpm 12's source lock may include its separate package-manager document.
    write('pnpm-lock.yaml', `---\n${stringify({ lockfileVersion: '9.0' })}---\n${stringify(lock)}`)
    write('node_modules/.pnpm/lock.yaml', stringify(installed))
  }
  try {
    write('package.json', JSON.stringify(pkg))
    write(
      'pnpm-workspace.yaml',
      stringify({ patchedDependencies: { 'node-pty@1.1.0': 'config/probe.patch' } })
    )
    write('config/probe.patch', patch)
    write('node_modules/.modules.yaml', stringify(metadata))
    write('native/package.json', JSON.stringify({ name: 'hive-local-probe', version: '1.0.0' }))
    write('native/index.js', 'module.exports = 1')
    cpSync(join(cwd, 'native'), join(cwd, 'node_modules/hive-local-probe'), { recursive: true })
    for (const name of Object.keys(dependencies).filter((name) => name !== 'hive-local-probe')) {
      write(`node_modules/${name}/package.json`, JSON.stringify({ name, main: 'index.js' }))
      write(`node_modules/${name}/index.js`, 'throw new Error("must not execute")')
    }
    writeLocks()
    const reusable = () =>
      canReuseInstalledDependencies({ root, toolchain: { pnpm: '12.0.0' } }, target)
    run({ cwd, pkg, lock, metadata, patch, write, writeLocks, reusable })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

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

it('reuses pnpm 12 locks after mapping reorder and pruning an unreferenced snapshot', () => {
  withInstalledDependencies(({ lock, writeLocks, reusable }) => {
    lock.snapshots['unused-peer@1.0.0'] = { dependencies: { 'node-pty': '1.1.0' } }
    const installed = Object.fromEntries(Object.entries(structuredClone(lock)).toReversed())
    delete installed.snapshots['unused-peer@1.0.0']
    installed.settings = { excludeLinksFromLockfile: false, autoInstallPeers: true }
    writeLocks(installed)
    expect(reusable()).toBe(true)
  })
})

it.each(['android', 'ios'])('reuses the complete hoisted mobile tree for %s', (target) => {
  withInstalledDependencies(({ reusable }) => expect(reusable()).toBe(true), target)
})

it.each(['importer', 'snapshot', 'alias'])(
  'rejects a missing snapshot referenced by the %s owner',
  (owner) => {
    withInstalledDependencies(({ lock, writeLocks, reusable }) => {
      let missing = 'node-pty@1.1.0'
      if (owner === 'snapshot') {
        missing = 'transitive@2.0.0'
        lock.snapshots[missing] = {}
        lock.snapshots['hive-local-probe@file:native'].optionalDependencies = {
          transitive: '2.0.0'
        }
      } else if (owner === 'alias') {
        missing = 'transitive@2.0.0'
        lock.snapshots[missing] = {}
        lock.snapshots['hive-local-probe@file:native'].dependencies = { alias: 'transitive@2.0.0' }
      }
      const installed = structuredClone(lock)
      delete installed.snapshots[missing]
      writeLocks(installed)
      expect(reusable()).toBe(false)
    })
  }
)

it.each(['additional snapshot', 'resolved version'])(
  'rejects an installed graph with a changed %s',
  (change) => {
    withInstalledDependencies(({ lock, writeLocks, reusable }) => {
      const installed = structuredClone(lock)
      if (change === 'additional snapshot') {
        installed.snapshots['unexpected@2.0.0'] = {}
      } else {
        installed.importers['.'].dependencies['node-pty'].version = '1.2.0'
      }
      writeLocks(installed)
      expect(reusable()).toBe(false)
    })
  }
)

it('rejects a manifest changed after the frozen install', () => {
  withInstalledDependencies(({ pkg, write, reusable }) => {
    pkg.dependencies['node-pty'] = '1.2.0'
    write('package.json', JSON.stringify(pkg))
    expect(reusable()).toBe(false)
  })
})

it('accepts CRLF patch bytes but rejects a changed patch against unchanged locks', () => {
  withInstalledDependencies(({ patch, write, reusable }) => {
    write('config/probe.patch', patch.replaceAll('\n', '\r\n'))
    expect(reusable()).toBe(true)
    write('config/probe.patch', `${patch}+module.exports = 2\n`)
    expect(reusable()).toBe(false)
  })
})

it('rejects stale installed local package content', () => {
  withInstalledDependencies(({ write, reusable }) => {
    write('native/index.js', 'module.exports = 2')
    expect(reusable()).toBe(false)
  })
})

it.each(['nodeLinker', 'packageManager'])(
  'rejects different installation metadata: %s',
  (field) => {
    withInstalledDependencies(({ metadata, write, reusable }) => {
      metadata[field] = field === 'nodeLinker' ? 'hoisted' : 'pnpm@11.0.0'
      write('node_modules/.modules.yaml', stringify(metadata))
      expect(reusable()).toBe(false)
    })
  }
)

it('rejects a mobile build tool with a missing entrypoint', () => {
  withInstalledDependencies(({ cwd, reusable }) => {
    rmSync(join(cwd, 'node_modules/@expo/cli/index.js'))
    expect(reusable()).toBe(false)
  }, 'ios')
})

const execution = vi.hoisted(() => ({ pnpmStep: vi.fn() }))
vi.mock('./client-build-execution.mjs', () => execution)

it('prepares every desktop dependency graph before returning to the builder', async () => {
  execution.pnpmStep.mockReset()
  const root = resolve('logs/sync-efficiency/build-preflight/missing-graphs')
  const context = { root, store: join(root, 'store'), toolchain: { pnpm: '12.8.1' } }
  await prepareTargetDependencies(context, 'windows-x64')
  expect(execution.pnpmStep.mock.calls.map((call) => call[3])).toEqual([
    root,
    join(root, 'runtime/native-pi'),
    join(root, 'runtime/managed-pi'),
    join(root, 'mobile')
  ])
  for (const call of execution.pnpmStep.mock.calls) {
    expect(call[2]).toEqual(
      expect.arrayContaining(['install', '--frozen-lockfile', '--store-dir', context.store])
    )
  }
  expect(execution.pnpmStep.mock.calls[1][2]).toContain('--node-linker=hoisted')
  expect(execution.pnpmStep.mock.calls[2][2]).toContain('--node-linker=isolated')
  expect(execution.pnpmStep.mock.calls[3][2]).toContain('--node-linker=hoisted')
})
it('stops preparation when a dependency graph fails', async () => {
  execution.pnpmStep.mockReset().mockRejectedValueOnce(new Error('frozen graph mismatch'))
  await expect(
    prepareTargetDependencies(
      { root: resolve('logs/missing-graphs'), store: 'store' },
      'windows-x64'
    )
  ).rejects.toThrow('frozen graph mismatch')
  expect(execution.pnpmStep).toHaveBeenCalledTimes(1)
})

it('doctor reaches toolchain preflight without loading any installed package', () => {
  const directory = resolve('logs/sync-efficiency/build-preflight/doctor-fixture')
  mkdirSync(directory, { recursive: true })
  const guard = join(directory, 'no-dependencies.mjs')
  writeFileSync(
    guard,
    `import { registerHooks } from 'node:module'
registerHooks({ resolve(specifier, context, next) {
  if (!specifier.startsWith('node:') && !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('file:') && !/^[A-Za-z]:/.test(specifier)) throw new Error('Fresh checkout cannot resolve package: ' + specifier)
  return next(specifier, context)
} })`
  )
  const pnpm = join(directory, 'pnpm-fixture.cjs')
  writeFileSync(pnpm, 'console.log("invalid-fixture-version")')
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      pathToFileURL(guard).href,
      resolve('config/scripts/client-build.mjs'),
      'doctor',
      '--target',
      'desktop'
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'npm_execpath')
        ),
        npm_execpath: pnpm,
        HIVECODE_BUILD_HOME: directory
      }
    }
  )
  expect(result.status).toBe(1)
  expect(result.stderr).toMatch(/pnpm .* required/)
  expect(result.stderr).not.toContain('Fresh checkout cannot resolve package')
})

it.each(['runtime/native-pi', 'runtime/managed-pi', 'mobile'])(
  'offline readiness rejects missing or stale %s without installing',
  (graph) => {
    withInstalledDependencies(({ cwd: root }) => {
      for (const directory of ['runtime/native-pi', 'runtime/managed-pi', 'mobile']) {
        withInstalledDependencies(
          ({ cwd }) => {
            cpSync(cwd, join(root, directory), { recursive: true })
          },
          directory === 'mobile' ? 'android' : 'windows-x64'
        )
      }
      writeFileSync(
        join(root, 'runtime/native-pi/node_modules/.modules.yaml'),
        stringify({ nodeLinker: 'hoisted', packageManager: 'pnpm@12.0.0' })
      )
      const context = { root, toolchain: { pnpm: '12.0.0' } }
      execution.pnpmStep.mockReset()
      expect(() => requireTargetDependencies(context, 'windows-x64')).not.toThrow()
      const entry = join(root, graph, 'node_modules/.modules.yaml')
      rmSync(entry)
      expect(() => requireTargetDependencies(context, 'windows-x64')).toThrow(
        'run clients:prepare -- --target windows-x64'
      )
      writeFileSync(
        join(root, graph, 'node_modules/.modules.yaml'),
        stringify({ nodeLinker: 'invalid', packageManager: 'pnpm@12.0.0' })
      )
      expect(() => requireTargetDependencies(context, 'windows-x64')).toThrow(
        'dependencies are missing or stale'
      )
      expect(execution.pnpmStep).not.toHaveBeenCalled()
    })
  }
)

it.skipIf(process.platform !== 'win32')(
  'doctor resolves case-insensitive Windows ProgramFiles environment names',
  () => {
    const directory = resolve('logs/sync-efficiency/build-preflight/windows-environment-fixture')
    mkdirSync(directory, { recursive: true })
    const pnpm = join(directory, 'pnpm-fixture.cjs')
    const toolchain = JSON.parse(readFileSync(resolve('config/toolchain.json'), 'utf8'))
    writeFileSync(pnpm, `console.log(${JSON.stringify(toolchain.pnpm)})`)
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !['npm_execpath', 'programfiles(x86)'].includes(key.toLowerCase())
      )
    )
    const result = spawnSync(
      process.execPath,
      [resolve('config/scripts/client-build.mjs'), 'doctor', '--target', 'windows-x64'],
      {
        encoding: 'utf8',
        windowsHide: true,
        env: {
          ...environment,
          npm_execpath: pnpm,
          'PROGRAMFILES(X86)': directory,
          HIVECODE_BUILD_HOME: directory
        }
      }
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('vswhere.exe')
    expect(result.stderr).not.toContain('Received undefined')
  }
)
