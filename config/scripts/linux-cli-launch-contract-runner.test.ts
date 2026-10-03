import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_DISPLAY_NAME, PRIMARY_CLI_COMMAND } from '../../src/shared/brand'

const { execFileSync } = vi.hoisted(() => ({ execFileSync: vi.fn() }))
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  execFileSync
}))
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
const caseOutput = {
  'nofuse-userns-bundled-help': `RESULT status=0\nUsage: ${PRIMARY_CLI_COMMAND} <command>`,
  'nofuse-userns-bundled-version': `RESULT status=0\n${pkg.version}`,
  'nofuse-userns-bundled-status': 'RESULT status=1\nappRunning',
  'nofuse-userns-bundled-skills': `RESULT status=0\nUsage: ${PRIMARY_CLI_COMMAND} skills`,
  'nofuse-userns-bundled-worktree': `RESULT status=1\n${APP_DISPLAY_NAME} is not running. Run '${PRIMARY_CLI_COMMAND} open' first.`,
  'nofuse-nosandbox-direct-binary-skills': `RESULT status=0\nUsage: ${PRIMARY_CLI_COMMAND} skills`,
  'nofuse-nosandbox-direct-binary-gui': 'RESULT status=1\nneeds a usable display server',
  'stale-display-nosandbox-direct-binary-gui': 'RESULT status=1\nneeds a usable display server'
}
let fixture: string
let artifact: string
let originalArgv: string[]
let originalExitCode: typeof process.exitCode

const commands = () => execFileSync.mock.calls.map(([, args]) => args as string[])
const cases = () => commands().filter((args) => Object.hasOwn(caseOutput, args.at(-1)!))

async function run() {
  process.argv = ['node', 'runner', '--appimage', artifact]
  await import('./run-linux-cli-launch-contract-docker.mjs')
}

beforeEach(() => {
  vi.resetModules()
  const fixtures = resolve('logs/open-source-baseline/linux-cli-version-contract-closure/fixtures')
  mkdirSync(fixtures, { recursive: true })
  fixture = mkdtempSync(join(fixtures, 'runner-'))
  artifact = join(fixture, 'original.AppImage')
  writeFileSync(artifact, 'original payload')
  originalArgv = process.argv
  originalExitCode = process.exitCode
  process.exitCode = undefined
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  execFileSync
    .mockReset()
    .mockImplementation(
      (_program: string, args: string[]) =>
        caseOutput[args.at(-1)! as keyof typeof caseOutput] ?? ''
    )
})

afterEach(() => {
  process.argv = originalArgv
  process.exitCode = originalExitCode
  vi.restoreAllMocks()
  rmSync(fixture, { recursive: true, force: true })
})

describe('Linux CLI launch Docker runner', () => {
  it('keeps all eight isolated cases and supplies primary identity and complete version', async () => {
    await run()
    expect(process.exitCode).toBeUndefined()
    expect(cases().map((args) => args.at(-1))).toEqual(Object.keys(caseOutput))
    for (const args of cases()) {
      expect(args).toContain(`ORCA_TEST_CLI_COMMAND=${PRIMARY_CLI_COMMAND}`)
      expect(args).toContain(`ORCA_TEST_EXPECTED_VERSION=${pkg.version}`)
      expect(args).not.toContain('--privileged')
      expect(args).not.toContain('--cap-add')
      expect(args).not.toContain('/dev/fuse')
    }
    expect(
      commands().some((args) =>
        args.some((arg) =>
          arg.includes(`test -x /artifacts/squashfs-root/resources/bin/${PRIMARY_CLI_COMMAND}`)
        )
      )
    ).toBe(true)
    expect(
      commands().some((args) => args.includes(`${artifact}:/input/orca-linux.AppImage:ro`))
    ).toBe(true)
    expect(commands().filter((args) => args[0] === 'rm')).toHaveLength(9)
    expect(commands().at(-2)?.slice(0, 2)).toEqual(['volume', 'rm'])
    expect(commands().at(-1)?.slice(0, 2)).toEqual(['image', 'rm'])
  })

  it('rejects a version prefix match and preserves the actual command output in diagnostics', async () => {
    execFileSync.mockImplementation((_program: string, args: string[]) =>
      args.at(-1) === 'nofuse-userns-bundled-version'
        ? `RESULT status=0\n${pkg.version}-foreign.1`
        : (caseOutput[args.at(-1)! as keyof typeof caseOutput] ?? '')
    )
    await run()
    expect(process.exitCode).toBe(1)
    expect(String(vi.mocked(console.error).mock.calls.at(-1)?.[0])).toContain(
      `${pkg.version}-foreign.1`
    )
    expect(cases()).toHaveLength(8)
    expect(commands().at(-1)?.slice(0, 2)).toEqual(['image', 'rm'])
  })

  it('reports the original mismatch body and nonzero status without dropping later cases', async () => {
    const body = `VERSION_MISMATCH expected=${pkg.version} got=foreign-version`
    execFileSync.mockImplementation((_program: string, args: string[]) =>
      args.at(-1) === 'nofuse-userns-bundled-version'
        ? `RESULT status=93\n${body}`
        : (caseOutput[args.at(-1)! as keyof typeof caseOutput] ?? '')
    )
    await run()
    expect(process.exitCode).toBe(1)
    expect(String(vi.mocked(console.error).mock.calls.at(-1)?.[0])).toContain(body)
    expect(cases()).toHaveLength(8)
  })
})
