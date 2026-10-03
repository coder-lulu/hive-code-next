import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { sha256 } from './client-build-contract.mjs'

const execution = vi.hoisted(() => ({ capture: vi.fn(), step: vi.fn(), nodeStep: vi.fn() }))
vi.mock('./client-build-execution.mjs', () => execution)
import { androidBundletoolPath, buildAndroid } from './client-build-android.mjs'

// Expo 55.0.30's bundled template.tgz, package/android/gradle/wrapper/gradle-wrapper.properties.
const expoWrapper = [
  'distributionBase=GRADLE_USER_HOME',
  'distributionPath=wrapper/dists',
  'distributionUrl=https\\://services.gradle.org/distributions/gradle-9.0.0-bin.zip',
  'networkTimeout=10000',
  'validateDistributionUrl=true',
  'zipStoreBase=GRADLE_USER_HOME',
  'zipStorePath=wrapper/dists',
  ''
].join('\n')
// https://gradle.org/release-checksums/ (Gradle 9.0.0 binary-only ZIP).
const officialChecksum = '8fad3d78296ca518113f3d29016617c7f9367dc005f932bd9d93bf45ba46072b'
let context
let fixture
let wrapperPath

function write(file, contents) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, contents)
}

beforeEach(() => {
  const logs = resolve('logs/all-platform-build/android-pin/fixtures')
  mkdirSync(logs, { recursive: true })
  fixture = mkdtempSync(join(logs, 'android-'))
  const release = JSON.parse(readFileSync(new URL('../client-build.json', import.meta.url), 'utf8'))
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  const app = JSON.parse(readFileSync(new URL('../../mobile/app.json', import.meta.url), 'utf8'))
  const cachedBundletool = 'fixture cached bundletool; no download or execution'
  release.android.bundletoolSha256 = sha256(cachedBundletool)
  context = {
    root: fixture,
    home: join(fixture, 'home'),
    work: join(fixture, 'work'),
    env: { JAVA_HOME: join(fixture, 'jdk'), ANDROID_HOME: join(fixture, 'sdk') },
    release,
    pkg,
    app
  }
  write(androidBundletoolPath(context), cachedBundletool)
  write(
    join(fixture, 'mobile/android/app/build.gradle'),
    `android {
      defaultConfig { versionName "${pkg.version}"; versionCode ${app.expo.android.versionCode} }
      signingConfigs { debug {} }
      buildTypes { release { signingConfig signingConfigs.debug } }
    }`
  )
  wrapperPath = join(fixture, 'mobile/android/gradle/wrapper/gradle-wrapper.properties')
  write(wrapperPath, expoWrapper)
  vi.clearAllMocks()
})

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true })
})

it('pins the actual Expo 55 wrapper and official checksum before assembling APK and AAB', async () => {
  const result = await buildAndroid(context, true)
  expect(context.release.android.gradle).toBe('9.0.0')
  expect(context.release.android.gradleSha256).toBe(officialChecksum)
  expect(readFileSync(wrapperPath, 'utf8')).toBe(
    `${expoWrapper}distributionSha256Sum=${officialChecksum}\n`
  )
  const [assemble, lockCheck] = execution.step.mock.calls
  expect(assemble[1]).toBe('android-assemble')
  expect(assemble[3]).toEqual(
    expect.arrayContaining([':app:assembleRelease', ':app:bundleRelease', '--write-locks'])
  )
  expect(lockCheck[1]).toBe('android-lock-check')
  expect(lockCheck[3]).toEqual(
    expect.arrayContaining([':app:assembleRelease', ':app:bundleRelease', '--offline'])
  )
  expect(lockCheck[3]).not.toContain('--write-locks')
  expect(result).toEqual({
    apk: join(fixture, 'mobile/android/app/build/outputs/apk/release/app-release.apk'),
    aab: join(fixture, 'mobile/android/app/build/outputs/bundle/release/app-release.aab')
  })
  expect(readFileSync(join(fixture, 'mobile/android/app/build.gradle'), 'utf8')).toContain(
    'signingConfig signingConfigs.release'
  )
})

it('runs the prepared wrapper offline without changing it or regenerating the project', async () => {
  const prepared = `${expoWrapper}distributionSha256Sum=${officialChecksum}\n`
  write(wrapperPath, prepared)
  await buildAndroid(context, false)
  expect(readFileSync(wrapperPath, 'utf8')).toBe(prepared)
  expect(execution.nodeStep.mock.calls.map((call) => call[1])).not.toContain('android-prebuild')
  expect(execution.step).toHaveBeenCalledOnce()
  expect(execution.step.mock.calls[0][3]).toEqual(
    expect.arrayContaining([':app:assembleRelease', ':app:bundleRelease', '--offline'])
  )
  expect(execution.step.mock.calls[0][3]).not.toContain('--write-locks')
})

it.each([true, false])(
  'refuses an old generated wrapper before Gradle runs (online=%s)',
  async (online) => {
    write(wrapperPath, expoWrapper.replace('gradle-9.0.0-bin.zip', 'gradle-8.13-bin.zip'))
    await expect(buildAndroid(context, online)).rejects.toThrow(
      'Gradle wrapper differs from pinned version'
    )
    expect(execution.step).not.toHaveBeenCalled()
  }
)

it.each([
  ['missing', ''],
  ['stale', 'distributionSha256Sum=stale\n'],
  ['ambiguous', `distributionSha256Sum=${officialChecksum}\ndistributionSha256Sum=stale\n`]
])('refuses a %s offline checksum', async (_name, checksum) => {
  write(wrapperPath, `${expoWrapper}${checksum}`)
  await expect(buildAndroid(context, false)).rejects.toThrow(
    'Gradle distribution checksum is missing or stale'
  )
  expect(execution.step).not.toHaveBeenCalled()
})

it('replaces an old checksum during online preparation with exactly one official pin', async () => {
  write(wrapperPath, `${expoWrapper}distributionSha256Sum=stale\n`)
  await buildAndroid(context, true)
  const wrapper = readFileSync(wrapperPath, 'utf8')
  expect(wrapper.match(/^distributionSha256Sum=/gm)).toHaveLength(1)
  expect(wrapper).toContain(`distributionSha256Sum=${officialChecksum}\n`)
})

it.each([
  expoWrapper.replace('services.gradle.org', 'mirror.invalid'),
  `${expoWrapper.replace('gradle-9.0.0-bin.zip', 'gradle-8.13-bin.zip')}# gradle-9.0.0-bin.zip\n`,
  `${expoWrapper}distributionUrl=https\\://services.gradle.org/distributions/gradle-8.13-bin.zip\n`
])('refuses an unpinned or ambiguous active distribution URL (%#)', async (wrapper) => {
  write(wrapperPath, wrapper)
  await expect(buildAndroid(context, true)).rejects.toThrow(
    'Gradle wrapper differs from pinned version'
  )
  expect(execution.step).not.toHaveBeenCalled()
})
