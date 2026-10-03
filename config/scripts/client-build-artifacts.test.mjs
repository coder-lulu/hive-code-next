import { beforeEach, describe, expect, it, vi } from 'vitest'
const { capture } = vi.hoisted(() => ({ capture: vi.fn() }))
vi.mock('./client-build-execution.mjs', () => ({ capture }))
import { verifyArtifacts } from './client-build-artifacts.mjs'

const digest = 'ab'.repeat(32)
const context = {
  env: { ANDROID_HOME: '/sdk', JAVA_HOME: '/jdk' },
  home: '/cache',
  release: {
    android: {
      buildTools: '36.0.0',
      bundletool: '1.18.3',
      architectures: ['armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64']
    }
  },
  pkg: { version: '1.5.0-beta.24' },
  app: { expo: { android: { package: 'com.hivekernel.hivecode.mobile', versionCode: 24 } } }
}
const source = { apk: '/build/release.apk', aab: '/build/release.aab' }
const outputs = () => [
  `Signer #1 certificate SHA-256 digest: ${digest}`,
  `SHA256: ${digest.toUpperCase()}`,
  "package: name='com.hivekernel.hivecode.mobile' versionCode='24' versionName='1.5.0-beta.24'\nnative-code: 'armeabi-v7a' 'arm64-v8a' 'x86' 'x86_64'",
  'jar verified.',
  `SHA256: ${digest.toUpperCase()}`,
  '<manifest package="com.hivekernel.hivecode.mobile" android:versionCode="24" android:versionName="1.5.0-beta.24"><application android:debuggable="false"/></manifest>',
  context.release.android.architectures.map((abi) => `base/lib/${abi}/libapp.so`).join('\n')
]
function supply(values) {
  for (const value of values) {
    capture.mockResolvedValueOnce(value)
  }
}

describe('Android release package validation', () => {
  beforeEach(() => capture.mockReset())
  it('requires signed APK and AAB with matching identity and all four ABIs', async () => {
    supply(outputs())
    const result = await verifyArtifacts(context, 'android', source)
    expect(result.files.map((file) => file.source)).toEqual([source.apk, source.aab])
    expect(result.signature).toEqual({ status: 'verified', sha256: digest })
  })
  it.each([
    [0, `Signer #1 certificate SHA-256 digest: ${'cd'.repeat(32)}`, 'APK signer'],
    [3, 'jar is unsigned.', 'bundle is not signed'],
    [4, `SHA256: ${'CD'.repeat(32)}`, 'AAB signer'],
    [5, '<manifest package="wrong"/>', 'bundle identity'],
    [5, outputs()[5].replace('debuggable="false"', 'debuggable="true"'), 'bundle identity'],
    [6, 'base/lib/arm64-v8a/libapp.so', 'AAB architecture']
  ])('rejects invalid package evidence at check %s', async (index, value, error) => {
    const values = outputs()
    values[index] = value
    supply(values)
    await expect(verifyArtifacts(context, 'android', source)).rejects.toThrow(error)
  })
})
