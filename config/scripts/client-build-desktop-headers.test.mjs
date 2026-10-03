import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, isAbsolute, resolve } from 'node:path'
import { sha256 } from './client-build-contract.mjs'
const { step } = vi.hoisted(() => ({ step: vi.fn() }))
vi.mock('./client-build-execution.mjs', () => ({ step, nodeStep: vi.fn(), pnpmStep: vi.fn() }))
import { matchesElectronHeaderChecksums, prepareElectronHeaders } from './client-build-desktop.mjs'

const digest = 'a'.repeat(64)
const checksums = (version, includeWindowsLib = true) =>
  [
    `${digest}  node-v${version}-headers.tar.gz`,
    ...(includeWindowsLib ? [`${digest}  win-x64/node.lib`] : [])
  ].join('\n')

describe('Electron header import version boundary', () => {
  it('extracts verified headers with relative tar paths, avoiding Windows drive remote syntax', async () => {
    const fixtures = resolve(import.meta.dirname, '../../logs/client-build-headers')
    mkdirSync(fixtures, { recursive: true })
    const home = mkdtempSync(join(fixtures, 'extract-'))
    try {
      const version = '43.7.5'
      const cache = join(home, 'cache/electron-headers', version)
      mkdirSync(cache, { recursive: true })
      const archive = `node-v${version}-headers.tar.gz`
      const bytes = Buffer.from('checked fixture archive')
      const lib = Buffer.from('checked fixture import library')
      writeFileSync(join(cache, archive), bytes)
      writeFileSync(
        join(cache, 'SHASUMS256.txt'),
        `${sha256(bytes)}  ${archive}\n${sha256(lib)}  win-${process.arch}/node.lib\n`
      )
      const include = join(cache, `node-v${version}/include/node`)
      mkdirSync(join(cache, `node-v${version}`, process.arch), { recursive: true })
      writeFileSync(join(cache, `node-v${version}`, process.arch, 'node.lib'), lib)
      step.mockImplementationOnce(async (_context, _label, program, args, cwd) => {
        expect(program).toBe('tar')
        expect(cwd).toBe(cache)
        expect(isAbsolute(args[1])).toBe(false)
        expect(args[1]).not.toContain(':')
        expect(args).toEqual(['-xzf', archive, '--strip-components=1', '-C', `node-v${version}`])
        mkdirSync(include, { recursive: true })
        writeFileSync(join(include, 'node.h'), 'verified header')
      })
      await prepareElectronHeaders({ home, toolchain: { electron: version }, local: {}, env: {} })
    } finally {
      const target = resolve(home)
      expect(target.startsWith(`${fixtures}${process.platform === 'win32' ? '\\' : '/'}`)).toBe(
        true
      )
      rmSync(target, { recursive: true, force: true })
    }
  })
  it('accepts only checksums for the pinned version and required host library', () => {
    expect(matchesElectronHeaderChecksums(checksums('43.7.0'), '43.7.0', 'win32', 'x64')).toBe(true)
    expect(matchesElectronHeaderChecksums(checksums('43.6.0'), '43.7.0', 'win32', 'x64')).toBe(
      false
    )
    expect(
      matchesElectronHeaderChecksums(checksums('43.7.0', false), '43.7.0', 'win32', 'x64')
    ).toBe(false)
    expect(
      matchesElectronHeaderChecksums(checksums('43.7.0', false), '43.7.0', 'linux', 'x64')
    ).toBe(true)
  })
})
