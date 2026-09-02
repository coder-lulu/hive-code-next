import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

const action = parse(readFileSync('.github/actions/install-node-dependencies/action.yml', 'utf8'))
const installScript = action.runs.steps.find((step) => step.name === 'Install dependencies').run

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options })
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'orca-install-node-action-'))
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
  writeFileSync(pnpm, '#!/bin/sh\nexit 0\n')
  chmodSync(pnpm, 0o755)
  return { bin, detachedCwd, root, workspace }
}

function executeInstallScript(fixture) {
  return run('bash', ['-c', installScript], {
    cwd: fixture.detachedCwd,
    env: {
      ...process.env,
      GITHUB_WORKSPACE: fixture.workspace,
      PATH: `${fixture.bin}${delimiter}${process.env.PATH}`
    }
  })
}

describe('install-node-dependencies action', () => {
  it('scopes native caches to the runner image and ABI inputs', () => {
    expect(action.inputs['persist-native-cache'].default).toBe('true')
    expect(action.outputs['native-cache-scope'].value).toContain('native-cache-scope')
    const scope = action.runs.steps.find((step) => step.name === 'Resolve native cache scope')
    expect(scope.id).toBe('native-cache-scope')
    expect(scope.run).toContain('/etc/os-release')
    const restore = action.runs.steps.find(
      (step) => step.name === 'Restore compiled native modules'
    )
    expect(restore.with.path).toContain('windows-native-registry')
    expect(restore.with.path).toContain('@vscode+windows-process-tree')
    expect(restore.with.key).toContain('steps.native-cache-scope.outputs.scope')
    expect(restore.with.key).toContain('runner.arch')
    expect(restore.with.key).toContain('node-pty@1.1.0.patch')
    expect(restore.with.key).toContain('@vscode__windows-process-tree@0.8.0.patch')
  })

  it('restores without saving when a job will rebuild under another ABI', () => {
    const restoreOnly = action.runs.steps.find(
      (step) => step.name === 'Restore compiled native modules without saving'
    )
    expect(restoreOnly.uses).toBe('actions/cache/restore@v5')
    expect(restoreOnly.if).toContain("inputs.persist-native-cache == 'false'")
  })

  it.each([
    ['package.json', '{"name":"changed"}\n'],
    ['pnpm-lock.yaml', 'lockfileVersion: 9\nchanged: true\n'],
    ['pnpm-workspace.yaml', 'packages: []\nchanged: true\n']
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
