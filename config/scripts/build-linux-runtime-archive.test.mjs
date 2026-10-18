import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'
import {
  runtimeManifest,
  runtimeLauncher,
  packRuntimeArchive,
  verifyArchivePayload
} from './build-linux-runtime-archive.mjs'

it.each(['x64', 'arm64'])('pins the %s archive identity and independent Node launcher', (arch) => {
  const manifest = runtimeManifest('1.5.0-beta.3', '42', arch)
  expect(manifest).toMatchObject({
    schemaVersion: 1,
    architecture: arch,
    buildNumber: 42,
    glibcMinimum: '2.31'
  })
  const launcher = runtimeLauncher(manifest)
  expect(launcher).toContain('orcad/orcad-server.js" --bind 0.0.0.0 "$@"')
  expect(launcher).toContain('orcad/out/cli/index.js" "$@"')
  expect(launcher).toContain('export ORCA_USER_DATA_PATH="$ORCA_USER_DATA"')
  expect(launcher).toMatch(/runtimes\/node-[a-f0-9]{64}\/bin\/node/)
  expect(launcher).not.toContain('\r')
})

it.each([
  ['bad', '1', 'x64'],
  ['1.5.0', '0', 'x64'],
  ['1.5.0', '9007199254740992', 'x64'],
  ['1.5.0', '1', 'riscv64']
])('rejects invalid identity %s/%s/%s', (...args) => {
  expect(() => runtimeManifest(...args)).toThrow()
})

it('creates a single-root portable tar and rejects linked or incomplete payloads', () => {
  const logs = resolve('logs/runtime-archive-tests')
  mkdirSync(logs, { recursive: true })
  const root = mkdtempSync(join(logs, 'archive-'))
  const payload = join(root, 'hivecode-runtime')
  mkdirSync(payload)
  const manifest = runtimeManifest('1.5.0', '1', 'x64')
  writeFileSync(join(payload, 'runtime-manifest.json'), JSON.stringify(manifest))
  try {
    expect(() => verifyArchivePayload(payload, manifest)).toThrow('Missing Runtime artifact')
    const archive = join(root, 'runtime.tar.gz')
    packRuntimeArchive(payload, archive)
    const list = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' })
    expect(list.status).toBe(0)
    expect(list.stdout.trim().split(/\r?\n/)).toEqual([
      'hivecode-runtime/',
      'hivecode-runtime/runtime-manifest.json'
    ])
    expect(readFileSync(archive).length).toBeGreaterThan(0)
    symlinkSync(payload, join(payload, 'link'), 'junction')
    expect(() => packRuntimeArchive(payload, archive)).toThrow('cannot contain links')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it.each([
  [{}, '/home/test/.config/HiveCode'],
  [{ XDG_CONFIG_HOME: '/xdg config' }, '/xdg config/HiveCode'],
  [{ XDG_CONFIG_HOME: '', XDG_DATA_HOME: '/unrelated' }, '/home/test/.config/HiveCode'],
  [{ ORCA_USER_DATA_PATH: '/cli profile' }, '/cli profile'],
  [{ ORCA_USER_DATA: '/server profile', ORCA_USER_DATA_PATH: '/cli profile' }, '/server profile']
])('uses the existing CLI profile for environment %j', (overrides, expected) => {
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
  const script = runtimeLauncher(runtimeManifest('1.5.0', '42', 'x64'))
  const assignments = script
    .split('\n')
    .filter((line) => /^(APP_NAME=|export ORCA_USER_DATA)/.test(line))
    .join('\n')
  const result = spawnSync(
    bash,
    [
      '--noprofile',
      '--norc',
      '-c',
      `${assignments}\nprintf '%s\\n%s' "$ORCA_USER_DATA" "$ORCA_USER_DATA_PATH"`
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: '/home/test',
        ORCA_USER_DATA: '',
        ORCA_USER_DATA_PATH: '',
        XDG_CONFIG_HOME: '',
        XDG_DATA_HOME: '',
        ...overrides
      }
    }
  )
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout).toBe(`${expected}\n${expected}`)
})

it('embeds the generated product name and quotes custom build identity safely', async () => {
  const { hivecodeProductConfig } = await import('../../src/shared/generated/product-config.ts')
  const manifest = runtimeManifest('1.5.0', '42', 'x64')
  expect(runtimeLauncher(manifest)).toContain(`APP_NAME='${hivecodeProductConfig.displayName}'`)
  expect(runtimeLauncher(manifest, "HiveCode RC's")).toContain(`APP_NAME='HiveCode RC'"'"'s'`)
})
