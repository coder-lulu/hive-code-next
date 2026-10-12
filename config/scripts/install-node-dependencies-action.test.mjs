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
  }

  expect(run('git', ['init', '-q'], { cwd: workspace }).status).toBe(0)
  expect(
    run('git', ['add', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'], {
      cwd: workspace
    }).status
  ).toBe(0)

  const pnpm = join(bin, 'pnpm')
  writeFileSync(
    pnpm,
    '#!/bin/sh\nif [ "$1" = store ]; then printf "%s\\n" "$PNPM_TEST_STORE_PATH"; exit 0; fi\nprintf "%s\\n" "$*" >> "$INSTALL_CALLS"\n'
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

describe('install-node-dependencies action', () => {
  it('installs only the current root dependencies', () => {
    expect(installScript).toContain('pnpm install --frozen-lockfile --ignore-scripts')
    expect(installScript).not.toMatch(/prepare:(?:managed|native)-pi/)
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
          TEST_NODE_ARCH: process.arch,
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
})
