import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runProcess } from '../../src/shared/child-process/run-process'
import { PRIMARY_CLI_COMMAND, CLI_COMPATIBILITY_ALIASES } from '../../src/shared/brand'
import { verifyPackageCliBin } from './verify-cli-bin.mjs'
import type { readOrcaCliVersion } from '../../src/cli/cli-version'

const reader = vi.hoisted(() => ({ runtimeDir: '' }))
vi.mock('../../src/cli/cli-version', async (importOriginal) => {
  const actual = await importOriginal<{ readOrcaCliVersion: typeof readOrcaCliVersion }>()
  return { ...actual, readOrcaCliVersion: () => actual.readOrcaCliVersion(reader.runtimeDir) }
})
import { main } from '../../src/cli/index'

const require = createRequire(import.meta.url)
const buildConfig = require('../electron-builder.config.cjs')
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
const source = readFileSync('config/docker/cli-launch-contract/run-cli-case.sh', 'utf8')
const launcherLine = source.split('\n').find((line) => line.startsWith('launcher='))!
const versionCheck = source.slice(
  source.indexOf('if [[ "$case_name" == nofuse-userns-bundled-version ]]'),
  source.indexOf('\n# Shell signal exits')
)
const bash =
  process.platform === 'win32'
    ? join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe')
    : 'bash'
let fixture: string
let shellRoot: string
let previousExitCode: typeof process.exitCode

beforeEach(async () => {
  const fixtures = resolve('logs/open-source-baseline/linux-cli-version-contract-closure/fixtures')
  mkdirSync(fixtures, { recursive: true })
  fixture = mkdtempSync(join(fixtures, 'version-'))
  const project = join(fixture, 'resources/app.asar.unpacked')
  reader.runtimeDir = join(project, 'out/cli')
  mkdirSync(reader.runtimeDir, { recursive: true })
  writeFileSync(join(project, 'package.json'), JSON.stringify(pkg))
  writeFileSync(join(reader.runtimeDir, 'index.js'), '#!/usr/bin/env node\n')
  verifyPackageCliBin({ projectDir: project, fixPackageJson: true, fixExecutable: true })
  previousExitCode = process.exitCode
  if (process.platform === 'win32') {
    const result = await runProcess({
      program: bash,
      args: ['--noprofile', '--norc', '-c', 'cygpath -u "$ORCA_TEST_ROOT"'],
      env: { ...process.env, ORCA_BACKGROUND_LAUNCH: '1', ORCA_TEST_ROOT: fixture }
    })
    expect(result.code).toBe(0)
    shellRoot = result.stdout.trim()
  } else {
    shellRoot = fixture
  }
})

afterEach(() => {
  process.exitCode = previousExitCode
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  rmSync(fixture, { recursive: true, force: true })
})

async function invokeVersion(command: string) {
  vi.stubEnv('HIVE_CLI_INVOKED_AS', command)
  const writes: string[] = []
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    writes.push(String(chunk))
    return true
  })
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    writes.push(String(chunk))
    return true
  })
  process.exitCode = 0
  try {
    await main(['--version'], fixture)
    return { status: Number(process.exitCode), output: writes.join('').trimEnd() }
  } finally {
    stdout.mockRestore()
    stderr.mockRestore()
  }
}

async function checkVersion(status: number, output: string) {
  return runProcess({
    program: bash,
    args: [
      '--noprofile',
      '--norc',
      '-c',
      [
        'set -uo pipefail',
        'case_name=nofuse-userns-bundled-version',
        'extracted_root="$ORCA_TEST_ROOT"',
        'status=$ORCA_TEST_STATUS',
        'output=$ORCA_TEST_OUTPUT',
        versionCheck,
        'printf \'RESULT status=%s\\n%s\\n\' "$status" "$output"'
      ].join('\n')
    ],
    env: {
      ...process.env,
      ORCA_BACKGROUND_LAUNCH: '1',
      ORCA_TEST_ROOT: shellRoot,
      ORCA_TEST_STATUS: String(status),
      ORCA_TEST_OUTPUT: output,
      ORCA_TEST_EXPECTED_VERSION: pkg.version
    }
  })
}

describe('Linux bundled CLI full-version oracle', () => {
  it('uses the primary launcher and accepts the real successful CLI version exactly', async () => {
    const selection = await runProcess({
      program: bash,
      args: [
        '--noprofile',
        '--norc',
        '-c',
        [
          'extracted_root=/fixture',
          'cli_command=$ORCA_TEST_CLI_COMMAND',
          launcherLine,
          'printf \'%s\' "${launcher##*/}"'
        ].join('\n')
      ],
      env: {
        ...process.env,
        ORCA_BACKGROUND_LAUNCH: '1',
        ORCA_TEST_CLI_COMMAND: PRIMARY_CLI_COMMAND
      }
    })
    const actual = await invokeVersion(selection.stdout)
    const result = await checkVersion(actual.status, actual.output)
    expect(result.stdout).toBe(`RESULT status=0\n${pkg.version}\n`)
    expect(selection.stdout).toBe(PRIMARY_CLI_COMMAND)
    expect(source).toContain(`"$extracted_root/${buildConfig.linux.executableName}"`)
  })

  it('retains the actual production alias warning and rejects it as version output', async () => {
    const actual = await invokeVersion(CLI_COMPATIBILITY_ALIASES[0])
    expect(actual.status).toBe(0)
    expect(actual.output).toContain('Warning:')
    expect(actual.output).toContain('is deprecated')
    expect(actual.output.endsWith(pkg.version)).toBe(true)
    const result = await checkVersion(actual.status, actual.output)
    expect(result.stdout).toContain('RESULT status=93')
  })

  it('rejects a different prerelease with the same numeric version', async () => {
    const changedVersion = `${pkg.version.split('-')[0]}-foreign.1`
    writeFileSync(
      join(reader.runtimeDir, '../package.json'),
      JSON.stringify({ version: changedVersion })
    )
    const actual = await invokeVersion(PRIMARY_CLI_COMMAND)
    const result = await checkVersion(actual.status, actual.output)
    expect(result.stdout).toContain('RESULT status=93')
    expect(result.stdout).toContain(`expected=${pkg.version} got=${changedVersion}`)
  })

  it('preserves the actual nonzero status when packaged version metadata is missing', async () => {
    rmSync(join(reader.runtimeDir, '../package.json'))
    const actual = await invokeVersion(PRIMARY_CLI_COMMAND)
    expect(actual.status).toBe(1)
    const result = await checkVersion(actual.status, actual.output)
    expect(result.stdout).toContain('RESULT status=1\n')
    expect(result.stdout).toContain('Could not determine')
  })
})
