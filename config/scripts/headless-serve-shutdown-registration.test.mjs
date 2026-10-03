import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runProcess } from '../../src/shared/child-process/run-process'
import { getAppImageCacheRootPath } from '../../src/main/cli/appimage-extracted-root'
import { resolveAppImageStableLauncherPath } from '../../src/main/cli/appimage-stable-launcher'
import { LINUX_CLI_COMMAND_NAME } from '../../src/main/cli/bundled-cli-launcher-path'

const source = readFileSync('config/docker/headless-serve-shutdown/run-signal-case.sh', 'utf8')
const registration = source.slice(
  source.indexOf('registered_cli_verified=false'),
  source.indexOf('\nbound_endpoint=')
)
const bash =
  process.platform === 'win32'
    ? join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe')
    : 'bash'
let fixture
let shellRoot
let registeredCli
let expectedTarget

beforeEach(async () => {
  const fixtures = resolve('logs/open-source-baseline/headless-oracle-brand-closure/fixtures')
  mkdirSync(fixtures, { recursive: true })
  fixture = mkdtempSync(join(fixtures, 'registration-'))
  if (process.platform === 'win32') {
    const converted = await runProcess({
      program: bash,
      args: ['--noprofile', '--norc', '-c', 'cygpath -u "$ORCA_REGISTRATION_ROOT"'],
      env: { ...process.env, ORCA_BACKGROUND_LAUNCH: '1', ORCA_REGISTRATION_ROOT: fixture }
    })
    expect(converted.code).toBe(0)
    shellRoot = converted.stdout.trim()
  } else {
    shellRoot = fixture
  }
  const launcher = join(fixture, 'home/.local/bin', LINUX_CLI_COMMAND_NAME)
  mkdirSync(join(fixture, 'home/.local/bin'), { recursive: true })
  writeFileSync(launcher, '#!/usr/bin/env bash\nprintf \'%s\\n\' "$ORCA_REGISTRATION_HELP"\n')
  chmodSync(launcher, 0o755)
  registeredCli = `${shellRoot}/home/.local/bin/${LINUX_CLI_COMMAND_NAME}`
  vi.stubEnv('XDG_CACHE_HOME', join(fixture, 'cache'))
  const stable = resolveAppImageStableLauncherPath(getAppImageCacheRootPath(join(fixture, 'home')))
  expectedTarget = `${shellRoot}/${relative(fixture, stable).replaceAll('\\', '/')}`
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(fixture, { recursive: true, force: true })
})

async function checkRegistration({
  target = expectedTarget,
  help = `Usage: ${LINUX_CLI_COMMAND_NAME} <command>`
} = {}) {
  return runProcess({
    program: bash,
    args: [
      '--noprofile',
      '--norc',
      '-c',
      [
        'set -euo pipefail',
        'HOME="$ORCA_REGISTRATION_HOME"',
        'XDG_CACHE_HOME="$ORCA_REGISTRATION_CACHE"',
        'entrypoint_kind=appimage',
        'cli_command=${ORCA_TEST_CLI_COMMAND:?product CLI command is required}',
        'readlink() { [[ "$1" == "$ORCA_EXPECTED_REGISTERED_CLI" ]] && printf \'%s\\n\' "$ORCA_REGISTERED_TARGET"; }',
        registration,
        'printf \'%s\' "$registered_cli_verified"'
      ].join('\n')
    ],
    env: {
      ...process.env,
      ORCA_BACKGROUND_LAUNCH: '1',
      ORCA_TEST_CLI_COMMAND: LINUX_CLI_COMMAND_NAME,
      ORCA_REGISTRATION_HOME: `${shellRoot}/home`,
      ORCA_REGISTRATION_CACHE: `${shellRoot}/cache`,
      ORCA_EXPECTED_REGISTERED_CLI: registeredCli,
      ORCA_REGISTERED_TARGET: target,
      ORCA_REGISTRATION_HELP: help
    }
  })
}

describe('AppImage shutdown registration oracle', () => {
  it('verifies the actual product primary command against the owned persistent launcher', async () => {
    expect(registration).not.toBe('')
    const result = await checkRegistration()
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toBe('true')
  })

  it('rejects another target even when the primary registered command can run', async () => {
    const result = await checkRegistration({ target: `${expectedTarget}-foreign` })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('FAIL: registered CLI target is')
  })

  it('rejects a successful help command whose header belongs to another CLI', async () => {
    const result = await checkRegistration({ help: 'Usage: foreign-command <command>' })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'FAIL: registered CLI did not execute the packaged help command'
    )
  })
})
