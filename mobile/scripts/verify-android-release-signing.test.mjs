import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  normalizeExpectedFingerprint,
  parseApkFingerprint,
  verifyAndroidReleaseSigning
} from './verify-android-release-signing.mjs'

const fingerprint = 'ab'.repeat(32)
const certificate = `Signer #1 certificate SHA-256 digest: ${fingerprint}\n`
const root = resolve(import.meta.dirname, '../..')
const env = {
  JAVA_HOME: resolve('fixture-java'),
  ANDROID_HOME: resolve('fixture-sdk'),
  HIVECODE_ANDROID_SIGNING_FINGERPRINT: fingerprint,
  HIVECODE_ANDROID_KEYSTORE_PATH: 'fixture.keystore',
  HIVECODE_ANDROID_KEYSTORE_PASSWORD: ' store secret ',
  HIVECODE_ANDROID_KEY_ALIAS: 'fixture-alias',
  HIVECODE_ANDROID_KEY_PASSWORD: ' key secret '
}
const options = (stdout = certificate) => ({
  env: { ...env },
  exists: () => true,
  run: vi.fn(() => ({ code: 0, timedOut: false, stdout, stderr: 'private tool detail' }))
})

describe('Android release signing verification', () => {
  it('requires an explicitly supplied process-host runner', () => {
    expect(() => verifyAndroidReleaseSigning('key', undefined, { env })).toThrow(
      'process-host runner missing'
    )
  })
  it('normalizes only the trusted expected fingerprint', () => {
    expect(normalizeExpectedFingerprint(` ${'AB:'.repeat(31)}AB\n`)).toBe(fingerprint)
    for (const value of [undefined, '', ' ', 'aa', 'z'.repeat(64), `ab ${'ab'.repeat(31)}`]) {
      expect(() => normalizeExpectedFingerprint(value)).toThrow(/expected fingerprint/)
    }
  })
  it('runs the existing private-key probe without trimming passwords or putting them in argv', () => {
    const opts = options(`${fingerprint}\n`)
    verifyAndroidReleaseSigning('key', undefined, opts)
    const [settings] = opts.run.mock.calls[0]
    const { program: java, args } = settings
    expect(java).toBe(
      resolve(env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    )
    expect(args).toEqual([resolve(root, 'config/scripts/AndroidSigningProbe.java')])
    expect(settings.env.HIVECODE_ANDROID_KEYSTORE_PASSWORD).toBe(' store secret ')
    expect(settings.env.HIVECODE_ANDROID_KEY_PASSWORD).toBe(' key secret ')
    expect(settings).toMatchObject({
      cwd: root,
      timeoutMs: 120_000,
      maxOutputBytes: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  })
  it('uses only the manifest-pinned SDK jar and validates the default APK', () => {
    const opts = options()
    verifyAndroidReleaseSigning('apk', undefined, opts)
    const pin = JSON.parse(readFileSync(resolve(root, 'config/client-build.json'), 'utf8')).android
      .buildTools
    expect(opts.run.mock.calls[0][0].args).toEqual([
      '-jar',
      resolve(env.ANDROID_HOME, 'build-tools', pin, 'lib/apksigner.jar'),
      'verify',
      '--verbose',
      '--print-certs',
      resolve(root, 'mobile/android/app/build/outputs/apk/release/app-release.apk')
    ])
  })
  it('refuses missing expectations and missing pinned tools before invocation', () => {
    const opts = options()
    delete opts.env.HIVECODE_ANDROID_SIGNING_FINGERPRINT
    expect(() => verifyAndroidReleaseSigning('apk', undefined, opts)).toThrow(
      'expected fingerprint missing'
    )
    expect(opts.run).not.toHaveBeenCalled()
    const missing = options()
    missing.exists = (file) => !file.endsWith('apksigner.jar')
    expect(() => verifyAndroidReleaseSigning('apk', undefined, missing)).toThrow(
      'pinned SDK apksigner.jar missing'
    )
    expect(missing.run).not.toHaveBeenCalled()
  })
  it.each(['key', 'apk'])('rejects %s tool failures without exposing tool output', (mode) => {
    for (const result of [
      { code: 1 },
      { code: null, signal: 'SIGTERM' },
      { code: 0, timedOut: true },
      { code: 0, outputTruncated: true }
    ]) {
      const opts = options()
      opts.run.mockReturnValue({ ...result, stdout: certificate, stderr: 'secret' })
      expect(() => verifyAndroidReleaseSigning(mode, undefined, opts)).toThrow(
        `${mode} tool verification failed`
      )
    }
    const opts = options()
    opts.run.mockImplementation(() => {
      throw new Error('secret')
    })
    expect(() => verifyAndroidReleaseSigning(mode, undefined, opts)).toThrow(
      `${mode} tool invocation failed`
    )
  })
  it.each(['key', 'apk'])('never replaces the trusted pin with the %s tool fingerprint', (mode) => {
    const opts = options(mode === 'key' ? fingerprint : certificate)
    opts.env.HIVECODE_ANDROID_SIGNING_FINGERPRINT = 'cd'.repeat(32)
    expect(() => verifyAndroidReleaseSigning(mode, undefined, opts)).toThrow(
      `${mode} fingerprint mismatch`
    )
    expect(opts.env.HIVECODE_ANDROID_SIGNING_FINGERPRINT).toBe('cd'.repeat(32))
  })
  it('rejects missing, duplicate, additional, malformed and wrong-number APK signers', () => {
    for (const output of [
      '',
      'Verifies\n',
      certificate + certificate,
      certificate + 'Signer #1 certificate SHA-256 digest: malformed\n',
      certificate.replace('#1', '#2'),
      certificate + 'Signer #2 certificate DN: other\n',
      certificate.replace(fingerprint, 'ab'.repeat(31)),
      certificate.replace(fingerprint, 'zz'.repeat(32))
    ]) {
      expect(() => parseApkFingerprint(output)).toThrow('APK signer output invalid')
    }
    expect(parseApkFingerprint(certificate.replace('\n', '\r\n'))).toBe(fingerprint)
  })
  it('rejects malformed key output and missing private-key settings', () => {
    expect(() =>
      verifyAndroidReleaseSigning('key', undefined, options('not a fingerprint'))
    ).toThrow('key probe output invalid')
    const opts = options(fingerprint)
    delete opts.env.HIVECODE_ANDROID_KEY_PASSWORD
    expect(() => verifyAndroidReleaseSigning('key', undefined, opts)).toThrow(
      'key configuration missing'
    )
    expect(opts.run).not.toHaveBeenCalled()
  })
})
