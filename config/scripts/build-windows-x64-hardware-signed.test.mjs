import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { preflightWindowsHardwareSigning } from './build-windows-x64-hardware-signed.mjs'

const scratch = mkdtempSync(join(tmpdir(), 'hivecode-windows-signing-preflight-'))
const signer = join(scratch, 'hardware-signer.exe')
const powershell = join(scratch, 'pwsh.exe')
writeFileSync(signer, 'signer')
writeFileSync(powershell, 'pwsh')

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const validOptions = {
  platform: 'win32',
  arch: 'x64',
  signingExecutable: signer,
  signingArguments: '["sign","--non-interactive","{file}"]',
  expectedSigners: '',
  expectedThumbprints: 'AA BB CC',
  signingTimeout: '120000',
  powershellExecutable: powershell
}

describe('Windows x64 hardware signing preflight', () => {
  it('validates every signing dependency without starting the package build', () => {
    expect(preflightWindowsHardwareSigning(validOptions)).toEqual({
      signingExecutable: signer,
      timeout: 120_000,
      powershellExecutable: powershell
    })
  })

  it('fails closed for the wrong runner architecture or incomplete identity allowlist', () => {
    expect(() => preflightWindowsHardwareSigning({ ...validOptions, arch: 'arm64' })).toThrow(
      'Windows x64'
    )
    expect(() =>
      preflightWindowsHardwareSigning({
        ...validOptions,
        expectedSigners: '',
        expectedThumbprints: ''
      })
    ).toThrow('expected Windows signer')
  })

  it('validates timeout and PowerShell before an expensive build can start', () => {
    expect(() =>
      preflightWindowsHardwareSigning({ ...validOptions, signingTimeout: '9999' })
    ).toThrow('must be between')
    expect(() =>
      preflightWindowsHardwareSigning({
        ...validOptions,
        powershellExecutable: join(scratch, 'missing-pwsh.exe')
      })
    ).toThrow('existing absolute file')
  })
})
