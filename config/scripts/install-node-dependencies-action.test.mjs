import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { delimiter, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

const action = parse(readFileSync('.github/actions/install-node-dependencies/action.yml', 'utf8'))
const nativeAction = parse(
  readFileSync('.github/actions/prepare-native-runtime/action.yml', 'utf8')
)
const installScript = action.runs.steps.find((step) => step.name === 'Install dependencies').run
const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'))
const storeScript = action.runs.steps.find((step) => step.id === 'pnpm-store').run

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options })
}

function createFixture() {
  const evidenceRoot = join(process.cwd(), 'logs/install-node-dependencies-action/fixtures')
  mkdirSync(evidenceRoot, { recursive: true })
  const root = mkdtempSync(join(evidenceRoot, 'install-node-action-'))
  const workspace = join(root, 'checkout')
  const detachedCwd = join(root, 'action cwd')
  const bin = join(root, 'bin')
  mkdirSync(workspace)
  mkdirSync(detachedCwd)
  mkdirSync(bin)

  for (const directory of [workspace, detachedCwd]) {
    writeFileSync(join(directory, 'package.json'), '{"name":"fixture"}\n')
    writeFileSync(join(directory, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    writeFileSync(join(directory, 'pnpm-workspace.yaml'), 'packages: []\n')
    for (const runtime of ['managed-pi', 'native-pi']) {
      const runtimeRoot = join(directory, 'runtime', runtime)
      mkdirSync(runtimeRoot, { recursive: true })
      writeFileSync(join(runtimeRoot, 'package.json'), '{"name":"runtime"}\n')
      writeFileSync(join(runtimeRoot, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
      writeFileSync(join(runtimeRoot, 'pnpm-workspace.yaml'), 'packages: []\n')
    }
  }

  expect(run('git', ['init', '-q'], { cwd: workspace }).status).toBe(0)
  expect(
    run('git', ['add', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'runtime'], {
      cwd: workspace
    }).status
  ).toBe(0)

  const pnpm = join(bin, 'pnpm')
  writeFileSync(
    pnpm,
    '#!/bin/sh\nif [ "$1" = store ]; then printf "%s\\n" "$PNPM_TEST_STORE_PATH"; exit 0; fi\nprintf "%s\\n" "$*" >> "$INSTALL_CALLS"\nif [ "$*" = "run prepare:managed-pi" ]; then exit "${PREPARE_EXIT:-0}"; fi\nif [ "$*" = "run prepare:native-pi" ]; then exit "${NATIVE_PREPARE_EXIT:-0}"; fi\n'
  )
  chmodSync(pnpm, 0o755)
  const node = join(bin, 'node')
  writeFileSync(
    node,
    '#!/bin/sh\nif [ "$1" = -p ]; then printf "%s\\n" "$TEST_NODE_ARCH"; exit 0; fi\nprintf "build-launched\\n" >> "$INSTALL_CALLS"\n'
  )
  chmodSync(node, 0o755)
  return { bin, detachedCwd, root, workspace, calls: join(root, 'calls.log') }
}

function executeInstallScript(
  fixture,
  command = installScript,
  prepareExit = '0',
  nativePrepareExit = '0'
) {
  return run('bash', ['-e', '-c', command], {
    cwd: fixture.detachedCwd,
    env: {
      ...process.env,
      GITHUB_WORKSPACE: fixture.workspace,
      INSTALL_CALLS: fixture.calls.replaceAll('\\', '/'),
      PREPARE_EXIT: prepareExit,
      NATIVE_PREPARE_EXIT: nativePrepareExit,
      PATH: `${fixture.bin}${delimiter}${process.env.PATH}`
    }
  })
}

describe('install-node-dependencies action', () => {
  it('keeps independent runtime installation frozen and before every build entry', () => {
    expect(scripts['prepare:managed-pi']).toBe(
      'pnpm --dir runtime/managed-pi install --frozen-lockfile --ignore-scripts'
    )
    for (const name of [
      'dev',
      'dev-stable-name',
      'build:electron-vite',
      'build:electron-vite:parallel'
    ]) {
      expect(scripts[name]).toMatch(/^pnpm run prepare:managed-pi && /)
    }
  })
  it.runIf(process.platform !== 'win32').each([
    ['/home/runner/pnpm store/v11', 'true'],
    ['/home/runner/pnpm store/v11', 'false'],
    ['C:\\Users\\runner\\pnpm store\\v11', 'true'],
    ['C:\\Users\\runner\\pnpm store\\v11', 'false']
  ])('preserves setup-node store path %s with producer lookup %s', (storePath, lookupOnly) => {
    const fixture = createFixture()
    const output = join(fixture.root, 'github-output')
    const environment = join(fixture.root, 'github-env')
    try {
      const result = run('bash', ['-e', '-o', 'pipefail', '-c', storeScript], {
        env: {
          ...process.env,
          GITHUB_OUTPUT: output,
          GITHUB_ENV: environment,
          STORE_LOOKUP_ONLY: lookupOnly,
          LOCKFILE_HASH: 'lockfile-digest',
          PNPM_TEST_STORE_PATH: storePath,
          PATH: `${fixture.bin}${delimiter}${process.env.PATH}`
        }
      })
      expect(result.status, result.stderr || result.stdout).toBe(0)
      expect(readFileSync(output, 'utf8')).toBe(`path=${storePath}\narch=${process.arch}\n`)
      if (lookupOnly === 'true') {
        expect(readFileSync(environment, 'utf8')).toBe(`ORCA_PNPM_STORE_CACHE_PATH=${storePath}\n`)
      } else {
        expect(existsSync(environment)).toBe(false)
      }
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it.runIf(process.platform !== 'win32').each([
    ['', 'store'],
    ['lockfile-digest', '']
  ])('rejects a missing lockfile hash or store path (%s, %s)', (hash, storePath) => {
    const fixture = createFixture()
    try {
      const result = run('bash', ['-e', '-o', 'pipefail', '-c', storeScript], {
        env: {
          ...process.env,
          GITHUB_OUTPUT: join(fixture.root, 'github-output'),
          LOCKFILE_HASH: hash,
          PNPM_TEST_STORE_PATH: storePath,
          PATH: `${fixture.bin}${delimiter}${process.env.PATH}`
        }
      })
      expect(result.status).toBe(1)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it.runIf(process.platform !== 'win32')(
    'prepares the independent runtime after the root install',
    () => {
      const fixture = createFixture()
      try {
        const result = executeInstallScript(fixture)
        expect(result.status, result.stderr || result.stdout).toBe(0)
        expect(readFileSync(fixture.calls, 'utf8').trim().split('\n')).toEqual([
          'install --frozen-lockfile --ignore-scripts',
          'run prepare:managed-pi',
          'run prepare:native-pi'
        ])
        expect(scripts['prepare:managed-pi']).toBe(
          'pnpm --dir runtime/managed-pi install --frozen-lockfile --ignore-scripts'
        )
        expect(scripts['prepare:native-pi']).toBe(
          'pnpm --dir runtime/native-pi install --frozen-lockfile --ignore-scripts'
        )
      } finally {
        rmSync(fixture.root, { recursive: true, force: true })
      }
    }
  )

  it.runIf(process.platform !== 'win32')(
    'fails the CI install when native-pi preparation fails',
    () => {
      const fixture = createFixture()
      try {
        expect(executeInstallScript(fixture, installScript, '0', '27').status).toBe(27)
        expect(readFileSync(fixture.calls, 'utf8').trim().split('\n')).toEqual([
          'install --frozen-lockfile --ignore-scripts',
          'run prepare:managed-pi',
          'run prepare:native-pi'
        ])
      } finally {
        rmSync(fixture.root, { recursive: true, force: true })
      }
    }
  )

  it.runIf(process.platform !== 'win32')('rejects native-pi lockfile drift in the checkout', () => {
    const fixture = createFixture()
    try {
      writeFileSync(
        join(fixture.workspace, 'runtime/native-pi/pnpm-lock.yaml'),
        'lockfileVersion: 10\n'
      )
      const result = executeInstallScript(fixture)
      expect(result.status, result.stderr || result.stdout).toBe(1)
      expect(result.stdout).toContain('runtime/native-pi/pnpm-lock.yaml')
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it
    .runIf(process.platform !== 'win32')
    .each(['dev', 'dev-stable-name', 'build:electron-vite', 'build:electron-vite:parallel'])(
    'stops %s before launching a build when runtime preparation fails',
    (script) => {
      const fixture = createFixture()
      try {
        const result = executeInstallScript(fixture, scripts[script], '23')
        expect(result.status, result.stderr || result.stdout).toBe(23)
        expect(readFileSync(fixture.calls, 'utf8')).toBe('run prepare:managed-pi\n')
      } finally {
        rmSync(fixture.root, { recursive: true, force: true })
      }
    }
  )

  it.runIf(process.platform !== 'win32')(
    'fails the CI install when runtime preparation fails',
    () => {
      const fixture = createFixture()
      try {
        expect(executeInstallScript(fixture, installScript, '23').status).toBe(23)
        expect(readFileSync(fixture.calls, 'utf8').trim().split('\n')).toEqual([
          'install --frozen-lockfile --ignore-scripts',
          'run prepare:managed-pi'
        ])
      } finally {
        rmSync(fixture.root, { recursive: true, force: true })
      }
    }
  )

  it
    .runIf(process.platform !== 'win32')
    .each(['dev', 'dev-stable-name', 'build:electron-vite', 'build:electron-vite:parallel'])(
    'prepares the runtime once before launching %s',
    (script) => {
      const fixture = createFixture()
      try {
        const result = executeInstallScript(fixture, scripts[script])
        expect(result.status, result.stderr || result.stdout).toBe(0)
        const calls = readFileSync(fixture.calls, 'utf8').trim().split('\n')
        expect(calls[0]).toBe('run prepare:managed-pi')
        expect(calls.filter((call) => call === 'run prepare:managed-pi')).toHaveLength(1)
        expect(calls.at(-1)).toBe('build-launched')
      } finally {
        rmSync(fixture.root, { recursive: true, force: true })
      }
    }
  )

  it('scopes native caches to the runner image and ABI inputs', () => {
    expect(action.inputs['persist-native-cache'].default).toBe('true')
    expect(action.outputs['native-cache-scope'].value).toBe(
      '${{ steps.native-runtime.outputs.cache-scope }}'
    )
    expect(nativeAction.outputs['cache-scope'].value).toContain('native-cache-scope')
    const scope = nativeAction.runs.steps.find((step) => step.name === 'Resolve native cache scope')
    expect(scope.id).toBe('native-cache-scope')
    expect(scope.run).toContain('/etc/os-release')
    const restore = nativeAction.runs.steps.find(
      (step) => step.name === 'Restore compiled native modules'
    )
    expect(restore.with.path).toContain('native/windows-registry/build')
    expect(scope.env.NATIVE_SOURCE_HASH).toContain('native/windows-registry/src/addon.cc')
    expect(scope.env.NATIVE_SOURCE_HASH).toContain('native/windows-registry/binding.gyp')
    expect(scope.env.NATIVE_SOURCE_HASH).toContain('native/windows-registry/package.json')
    expect(restore.with.path).toContain(
      'node_modules/.pnpm/@vscode+windows-process-tre*/node_modules/@vscode/windows-process-tree/build'
    )
    expect(restore.with.key).toBe('${{ steps.native-cache-scope.outputs.key }}')
    expect(scope.run).toContain('"$scope" "$RUNNER_ARCH" "$NATIVE_RUNTIME" "$NODE_VERSION"')
    expect(scope.run).toContain('"$NATIVE_SOURCE_HASH"')
    expect(scope.env.NATIVE_SOURCE_HASH).toContain('node-pty@1.1.0.patch')
    expect(scope.env.NATIVE_SOURCE_HASH).toContain('@vscode__windows-process-tree@0.8.0.patch')
  })

  it('restores without saving when a job will rebuild under another ABI', () => {
    const restoreOnly = nativeAction.runs.steps.find(
      (step) => step.name === 'Restore compiled native modules without saving'
    )
    expect(restoreOnly.uses).toBe('actions/cache/restore@v5')
    expect(restoreOnly.if).toContain("inputs.persist-native-cache == 'false'")
  })

  it.runIf(process.platform !== 'win32').each([
    ['package.json', '{"name":"changed"}\n'],
    ['pnpm-lock.yaml', 'lockfileVersion: 9\nchanged: true\n'],
    ['pnpm-workspace.yaml', 'packages: []\nchanged: true\n'],
    ['runtime/managed-pi/package.json', '{"name":"changed"}\n'],
    ['runtime/managed-pi/pnpm-lock.yaml', 'lockfileVersion: 9\nchanged: true\n'],
    ['runtime/managed-pi/pnpm-workspace.yaml', 'packages: []\nchanged: true\n']
  ])('rejects a changed %s when the composite step cwd is detached', (file, contents) => {
    const fixture = createFixture()
    try {
      const clean = executeInstallScript(fixture)
      expect(clean.status, clean.stderr || clean.stdout).toBe(0)

      writeFileSync(join(fixture.workspace, file), contents)
      const dirty = executeInstallScript(fixture)
      const output = `${dirty.stdout}\n${dirty.stderr}`
      expect(dirty.status).toBe(1)
      expect(output).toContain(`diff --git a/${file} b/${file}`)
      expect(output).not.toContain('diff --git a/package.json b/pnpm-lock.yaml')
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })
})
