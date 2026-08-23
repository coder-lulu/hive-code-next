import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SIGNING_TIMEOUT_MS,
  parseSigningArguments,
  parseSigningTimeout,
  sign,
  signWindowsArtifact
} from './sign-windows-artifact.mjs'
import { verifyHiveCodeWindowsArtifacts } from './verify-hivecode-windows-artifact.mjs'

const scratch = mkdtempSync(join(tmpdir(), 'hivecode-signing-'))
afterEach(() => vi.restoreAllMocks())

describe('Windows hardware signing hook', () => {
  it('runs one absolute non-shell signer and verifies the resulting Authenticode identity', () => {
    const signer = join(scratch, 'signer.exe')
    const artifact = join(scratch, 'hivecode-windows-setup.exe')
    writeFileSync(signer, 'signer')
    writeFileSync(artifact, 'MZ')
    const spawn = vi.fn().mockReturnValue({ status: 0 })
    const verify = vi.fn().mockReturnValue({ status: 'Valid' })

    signWindowsArtifact({
      artifact,
      signingExecutable: signer,
      signingArguments: JSON.stringify(['sign', '--non-interactive', '{file}']),
      expectedSigners: 'CN=HiveKernel Release Signing',
      expectedThumbprints: '',
      spawnSyncImpl: spawn,
      verifyImpl: verify,
      platform: 'win32'
    })

    expect(spawn).toHaveBeenCalledWith(
      signer,
      ['sign', '--non-interactive', artifact],
      expect.objectContaining({
        shell: false,
        timeout: DEFAULT_SIGNING_TIMEOUT_MS,
        windowsHide: true,
        stdio: 'inherit'
      })
    )
    expect(verify).toHaveBeenCalledWith(
      expect.objectContaining({
        executablePath: artifact,
        expectedSigners: ['CN=HiveKernel Release Signing']
      })
    )
  })

  it('rejects argument strings that cannot bind the exact artifact path', () => {
    expect(() => parseSigningArguments('["sign","artifact.exe"]')).toThrow('{file} placeholder')
    expect(() => parseSigningArguments('--file artifact.exe')).toThrow('JSON string array')
  })

  it('bounds the non-interactive signer timeout and reports a timeout distinctly', () => {
    expect(parseSigningTimeout()).toBe(DEFAULT_SIGNING_TIMEOUT_MS)
    expect(parseSigningTimeout('10000')).toBe(10_000)
    expect(() => parseSigningTimeout('9999')).toThrow('must be between')
    expect(() => parseSigningTimeout('1800001')).toThrow('must be between')
    expect(() => parseSigningTimeout('10s')).toThrow('must be an integer')

    const signer = join(scratch, 'timeout-signer.exe')
    const artifact = join(scratch, 'timeout-artifact.exe')
    writeFileSync(signer, 'signer')
    writeFileSync(artifact, 'MZ')
    const timeoutError = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })
    expect(() =>
      signWindowsArtifact({
        artifact,
        signingExecutable: signer,
        signingArguments: '["sign","{file}"]',
        signingTimeout: '15000',
        expectedSigners: 'CN=HiveKernel Release Signing',
        spawnSyncImpl: () => ({ error: timeoutError, status: null }),
        verifyImpl: vi.fn(),
        platform: 'win32'
      })
    ).toThrow('exceeded the 15000ms timeout')
  })

  it('rejects non-SHA-256 electron-builder signing tasks before invoking a signer', async () => {
    await expect(sign({ hash: 'sha1', path: 'artifact.exe' })).rejects.toThrow(
      'only accepts SHA-256'
    )
  })

  it('wires the opt-in hook into the Windows x64 build without embedding credentials', () => {
    const config = readFileSync('config/electron-builder.config.cjs', 'utf8')
    const wrapper = readFileSync('config/scripts/build-windows-x64-hardware-signed.mjs', 'utf8')
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))

    expect(config).toContain("process.env.HIVECODE_WINDOWS_HARDWARE_SIGNING === '1'")
    expect(config).toContain("sign: './config/scripts/sign-windows-artifact.mjs'")
    expect(config).toContain("signingHashAlgorithms: ['sha256']")
    expect(wrapper).toMatch(/'--win',\s*'--x64'/u)
    expect(wrapper).toContain('shell: false')
    expect(packageJson.scripts['build:win:x64:hardware-signed']).toContain(
      'build-windows-x64-hardware-signed.mjs'
    )
    expect(packageJson.scripts['build:win:x64:hardware-signed']).toMatch(
      /^pnpm run preflight:windows:hardware &&/
    )
    expect(config).not.toMatch(/PRIVATE[_-]?KEY|CLIENT[_-]?SECRET/u)
  })

  it('verifies final HiveCode artifacts with an explicit HiveCode identity allowlist', () => {
    const artifact = join(scratch, 'final-installer.exe')
    writeFileSync(artifact, 'MZ')
    const verify = vi.fn()

    expect(
      verifyHiveCodeWindowsArtifacts([artifact], {
        expectedSigners: '',
        expectedThumbprints: 'aa bb cc',
        powershellExecutable: 'C:\\PowerShell\\pwsh.exe',
        verifyImpl: verify
      })
    ).toEqual([artifact])
    expect(verify).toHaveBeenCalledWith(
      expect.objectContaining({
        executablePath: artifact,
        expectedSigners: [],
        expectedThumbprints: ['AABBCC']
      })
    )
    expect(() =>
      verifyHiveCodeWindowsArtifacts([artifact], {
        expectedSigners: '',
        expectedThumbprints: '',
        verifyImpl: verify
      })
    ).toThrow('expected Windows signer')
  })
})

process.on('exit', () => rmSync(scratch, { recursive: true, force: true }))
