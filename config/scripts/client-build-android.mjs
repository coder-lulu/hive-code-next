import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { configureReleaseSigning } from '../../mobile/scripts/configure-android-release-signing.mjs'
import { capture, nodeStep, step } from './client-build-execution.mjs'
import { sha256 } from './client-build-contract.mjs'

export function androidBundletoolPath(context) {
  return join(
    context.home,
    'cache',
    'bundletool',
    `bundletool-all-${context.release.android.bundletool}.jar`
  )
}

function configureGradleWrapper(wrapper, pin, online) {
  const lines = wrapper.split(/\r?\n/)
  const distributions = lines.flatMap((line) => {
    const match = line.match(/^\s*distributionUrl(?:\s*[=:]\s*|\s+)(.*)$/)
    return match ? [match[1].replaceAll('\\:', ':')] : []
  })
  const expectedUrl = `https://services.gradle.org/distributions/gradle-${pin.gradle}-bin.zip`
  if (distributions.length !== 1 || distributions[0] !== expectedUrl) {
    throw new Error(
      `Gradle wrapper differs from pinned version: expected ${expectedUrl}; found ${distributions.join(', ') || 'no distribution URL'}`
    )
  }
  const checksumProperty = /^\s*distributionSha256Sum(?:\s*[=:]|\s+)/
  const checksums = lines.filter((line) => checksumProperty.test(line))
  const expectedChecksum = `distributionSha256Sum=${pin.gradleSha256}`
  if (online) {
    return `${lines
      .filter((line) => !checksumProperty.test(line))
      .join('\n')
      .trimEnd()}\n${expectedChecksum}\n`
  }
  if (checksums.length !== 1 || checksums[0] !== expectedChecksum) {
    throw new Error('Gradle distribution checksum is missing or stale; run clients:prepare')
  }
  return wrapper
}

async function prepareBundletool(context, online) {
  const file = androidBundletoolPath(context)
  const expected = context.release.android.bundletoolSha256
  if (existsSync(file) && sha256(readFileSync(file)) === expected) {
    return
  }
  if (!online) {
    throw new Error('Pinned bundletool is missing or stale; run clients:prepare')
  }
  const version = context.release.android.bundletool
  const response = await fetch(
    `https://github.com/google/bundletool/releases/download/${version}/bundletool-all-${version}.jar`,
    { signal: AbortSignal.timeout(120_000) }
  )
  if (!response.ok) {
    throw new Error(`Cannot prepare bundletool: HTTP ${response.status}`)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (sha256(bytes) !== expected) {
    throw new Error('Official bundletool checksum mismatch')
  }
  mkdirSync(join(context.home, 'cache', 'bundletool'), { recursive: true })
  writeFileSync(file, bytes)
}

export function gradleProxyArguments(environment) {
  const args = []
  for (const protocol of ['http', 'https']) {
    const value = environment[`${protocol.toUpperCase()}_PROXY`] || environment[`${protocol}_proxy`]
    if (!value) {
      continue
    }
    const proxy = new URL(value)
    if (proxy.protocol !== 'http:' || proxy.username || proxy.password) {
      throw new Error(
        'Gradle requires an unauthenticated HTTP CONNECT proxy or existing secure Gradle proxy configuration'
      )
    }
    args.push(
      `-D${protocol}.proxyHost=${proxy.hostname}`,
      `-D${protocol}.proxyPort=${proxy.port || '80'}`
    )
  }
  return args
}

export function loadAndroidSigning(context) {
  const { env, local } = context
  if (local.androidSigningCredentials) {
    const text = readFileSync(local.androidSigningCredentials, 'utf8')
    const fields = {
      HIVECODE_ANDROID_KEY_ALIAS: 'Alias',
      HIVECODE_ANDROID_KEYSTORE_PASSWORD: 'Keystore password',
      HIVECODE_ANDROID_KEY_PASSWORD: 'Key password'
    }
    env.HIVECODE_ANDROID_SIGNING_FINGERPRINT ||= text
      .split(/\r?\n/)
      .find((line) => line.startsWith('Certificate SHA-256:'))
      ?.slice('Certificate SHA-256:'.length)
      .trim()
    for (const [key, label] of Object.entries(fields)) {
      env[key] ||= text
        .split(/\r?\n/)
        .find((line) => line.startsWith(`${label}:`))
        ?.slice(label.length + 1)
        .trim()
    }
  }
  env.HIVECODE_ANDROID_KEYSTORE_PATH ||= local.androidKeystore
  for (const key of [
    'HIVECODE_ANDROID_KEYSTORE_PATH',
    'HIVECODE_ANDROID_KEY_ALIAS',
    'HIVECODE_ANDROID_KEYSTORE_PASSWORD',
    'HIVECODE_ANDROID_KEY_PASSWORD'
  ]) {
    if (!env[key]) {
      throw new Error(
        `Android signing requires ${key}; configure environment or .client-build.local.json`
      )
    }
  }
  if (!existsSync(env.HIVECODE_ANDROID_KEYSTORE_PATH)) {
    throw new Error('Android keystore does not exist')
  }
}

export async function androidPreflight(context) {
  loadAndroidSigning(context)
  const pin = context.release.android
  const java = join(
    context.env.JAVA_HOME || '',
    'bin',
    process.platform === 'win32' ? 'java.exe' : 'java'
  )
  if (!context.env.JAVA_HOME || !existsSync(java)) {
    throw new Error('Set javaHome / JAVA_HOME to the pinned JDK')
  }
  const version = await capture(context, java, ['-version'])
  if (!version.includes(`version "${pin.java}"`)) {
    throw new Error(`Android requires JDK ${pin.java}`)
  }
  const certificate = await capture(context, java, [
    join(context.root, 'config/scripts/AndroidSigningProbe.java')
  ])
  const expected = context.env.HIVECODE_ANDROID_SIGNING_FINGERPRINT?.replaceAll(
    ':',
    ''
  ).toLowerCase()
  if (expected && certificate !== expected) {
    throw new Error('Android keystore does not match the expected release certificate')
  }
  const sdk = context.env.ANDROID_HOME
  if (!sdk) {
    throw new Error('Set androidSdk / ANDROID_HOME')
  }
  for (const relative of [
    `platforms/android-${pin.compileSdk}/android.jar`,
    `build-tools/${pin.buildTools}/source.properties`,
    `ndk/${pin.ndk}/source.properties`,
    `cmake/${pin.cmake}/source.properties`
  ]) {
    if (!existsSync(join(sdk, relative))) {
      throw new Error(`Android SDK resource missing: ${relative}`)
    }
  }
}

export async function buildAndroid(context, online) {
  await prepareBundletool(context, online)
  const mobile = join(context.root, 'mobile')
  const native = join(mobile, 'android')
  for (const script of ['build-terminal-webview-engine', 'build-mermaid-webview-engine']) {
    await nodeStep(context, script, join(mobile, 'scripts', `${script}.mjs`), [], mobile)
  }
  if (online) {
    await nodeStep(
      context,
      'android-prebuild',
      join(mobile, 'node_modules/expo/bin/cli'),
      ['prebuild', '--platform', 'android', '--no-install'],
      mobile
    )
  }
  const gradlePath = join(native, 'app/build.gradle')
  let source = readFileSync(gradlePath, 'utf8')
  source = configureReleaseSigning(source)
  if (
    !source.includes(`versionName "${context.pkg.version}"`) ||
    !source.includes(`versionCode ${context.app.expo.android.versionCode}`)
  ) {
    throw new Error('Generated Android version is stale; run clients:prepare')
  }
  writeFileSync(gradlePath, source)
  writeFileSync(
    join(native, 'local.properties'),
    `sdk.dir=${context.env.ANDROID_HOME.replaceAll('\\', '/')}\n`
  )
  const wrapper = readFileSync(join(native, 'gradle/wrapper/gradle-wrapper.properties'), 'utf8')
  const pinnedWrapper = configureGradleWrapper(wrapper, context.release.android, online)
  if (online) {
    writeFileSync(join(native, 'gradle/wrapper/gradle-wrapper.properties'), pinnedWrapper)
  }
  await nodeStep(
    context,
    'android-typecheck',
    join(mobile, 'node_modules/typescript/bin/tsc'),
    ['--noEmit'],
    mobile
  )
  const args = [
    ...gradleProxyArguments(context.env),
    '-classpath',
    join(native, 'gradle/wrapper/gradle-wrapper.jar'),
    'org.gradle.wrapper.GradleWrapperMain',
    ':app:assembleRelease',
    ':app:bundleRelease',
    '--console=plain',
    '-Pandroid.builder.sdkDownload=false',
    `-PreactNativeArchitectures=${context.release.android.architectures.join(',')}`,
    ...(online ? ['--write-locks'] : ['--offline']),
    '--init-script',
    join(context.root, 'config/scripts/client-build-android.init.gradle')
  ]
  context.env.HIVECODE_ANDROID_LOCK_ROOT = join(mobile, 'gradle-locks')
  context.env.HIVECODE_ANDROID_PROJECT_ROOT = native
  const init = join(context.work, 'android', 'toolchain.gradle')
  mkdirSync(join(context.work, 'android'), { recursive: true })
  const pin = context.release.android
  const expected = {
    buildToolsVersion: pin.buildTools,
    compileSdkVersion: pin.compileSdk,
    targetSdkVersion: pin.targetSdk,
    minSdkVersion: pin.minSdk,
    ndkVersion: pin.ndk
  }
  writeFileSync(
    init,
    `gradle.projectsEvaluated {\n  if (gradle.rootProject.projectDir.canonicalPath != new File(System.getenv('HIVECODE_ANDROID_PROJECT_ROOT')).canonicalPath) return\n${Object.entries(
      expected
    )
      .map(
        ([key, value]) =>
          `  if (gradle.rootProject.ext.get('${key}').toString() != '${value}') throw new GradleException('HiveCode toolchain mismatch: ${key}')`
      )
      .join('\n')}\n}\n`
  )
  args.push('--init-script', init)
  await step(
    context,
    'android-assemble',
    join(context.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'),
    args,
    native
  )
  if (online) {
    await step(
      context,
      'android-lock-check',
      join(context.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'),
      [...args.filter((arg) => arg !== '--write-locks'), '--offline'],
      native
    )
  }
  return {
    apk: join(native, 'app/build/outputs/apk/release/app-release.apk'),
    aab: join(native, 'app/build/outputs/bundle/release/app-release.aab')
  }
}
