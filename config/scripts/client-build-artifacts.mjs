import { cpSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createRequire } from 'node:module'
import { capture } from './client-build-execution.mjs'
import { sha256 } from './client-build-contract.mjs'

export async function verifyArtifacts(context, name, source) {
  if (name === 'android') {
    const bin = join(context.env.ANDROID_HOME, 'build-tools', context.release.android.buildTools)
    const java = join(
      context.env.JAVA_HOME,
      'bin',
      process.platform === 'win32' ? 'java.exe' : 'java'
    )
    const signature = await capture(context, java, [
      '-jar',
      join(bin, 'lib/apksigner.jar'),
      'verify',
      '--verbose',
      '--print-certs',
      source
    ])
    const fingerprint = signature
      .match(/Signer #1 certificate SHA-256 digest: ([a-f0-9]+)/i)?.[1]
      ?.toLowerCase()
    const certificate = await capture(
      context,
      join(context.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool'),
      [
        '-list',
        '-v',
        '-keystore',
        context.env.HIVECODE_ANDROID_KEYSTORE_PATH,
        '-storepass:env',
        'HIVECODE_ANDROID_KEYSTORE_PASSWORD',
        '-alias',
        context.env.HIVECODE_ANDROID_KEY_ALIAS,
        '-J-Duser.language=en'
      ]
    )
    const expected = certificate
      .match(/SHA256:\s*([A-F0-9:]+)/)?.[1]
      ?.replaceAll(':', '')
      .toLowerCase()
    if (!fingerprint || fingerprint !== expected) {
      throw new Error('APK signer does not match the configured release key')
    }
    const metadata = await capture(
      context,
      join(bin, process.platform === 'win32' ? 'aapt.exe' : 'aapt'),
      ['dump', 'badging', source]
    )
    if (
      !metadata.includes(`versionName='${context.pkg.version}'`) ||
      !metadata.includes(`versionCode='${context.app.expo.android.versionCode}'`) ||
      !metadata.includes(`name='${context.app.expo.android.package}'`) ||
      metadata.includes('application-debuggable')
    ) {
      throw new Error('APK identity or release mode validation failed')
    }
    const architectures = [
      ...(metadata.match(/^native-code: (.+)$/m)?.[1] || '').matchAll(/'([^']+)'/g)
    ]
      .map((match) => match[1])
      .sort()
    if (
      JSON.stringify(architectures) !==
      JSON.stringify([...context.release.android.architectures].sort())
    ) {
      throw new Error('APK architecture coverage differs')
    }
    return {
      files: [{ source, name: `HiveCode-Android-${context.pkg.version}.apk` }],
      signature: { status: 'verified', sha256: fingerprint }
    }
  }
  const files = readdirSync(source)
    .filter((file) => /\.(exe|blockmap|AppImage|deb|rpm|dmg|zip|yml)$/.test(file))
    .map((file) => ({ source: join(source, file), name: file }))
  if (!files.some((file) => /\.(exe|AppImage|dmg)$/.test(file.name))) {
    throw new Error('Desktop installer is missing')
  }
  if (name.startsWith('windows')) {
    const require = createRequire(import.meta.url)
    const asar = require('@electron/asar')
    const metadata = JSON.parse(
      asar.extractFile(join(source, 'win-unpacked/resources/app.asar'), 'package.json').toString()
    )
    if (
      metadata.version !== context.pkg.version ||
      metadata.hivecodeBuildNumber !== context.release.desktopBuildNumber ||
      metadata.hivecodeReleaseIdentity?.commitSha !== context.env.HIVECODE_COMMIT_SHA
    ) {
      throw new Error('Packaged desktop identity differs')
    }
    return { files, signature: { status: 'not-checked' } }
  }
  return { files, signature: { status: 'platform-packaging-checks' } }
}

export function deliverArtifacts(context, name, verified, fingerprint) {
  // Target directories prevent one architecture or host from replacing another's manifest.
  const destination = join(context.output, name, context.attempt)
  const stage = `${destination}.partial`
  mkdirSync(stage, { recursive: true })
  const artifacts = verified.files.map((file) => {
    cpSync(file.source, join(stage, file.name))
    return { file: file.name, sha256: sha256(readFileSync(join(stage, file.name))) }
  })
  const manifest = {
    schemaVersion: 1,
    target: name,
    version: context.pkg.version,
    desktopBuildNumber: context.release.desktopBuildNumber,
    androidVersionCode: context.app.expo.android.versionCode,
    source: context.source,
    dependencyFingerprint: fingerprint,
    toolchain: context.toolchain,
    buildConfiguration: context.release,
    signature: verified.signature,
    artifacts,
    logs: context.logs
  }
  writeFileSync(join(stage, 'build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(
    join(stage, 'SHA256SUMS.txt'),
    artifacts.map((file) => `${file.sha256}  ${file.file}\n`).join('')
  )
  renameSync(stage, destination)
  const pointer = join(context.output, name, 'latest.json')
  const temporary = `${pointer}.tmp`
  writeFileSync(
    temporary,
    `${JSON.stringify({ directory: basename(destination), manifest: `${basename(destination)}/build-manifest.json` }, null, 2)}\n`
  )
  renameSync(temporary, pointer)
  console.log(`[clients] Verified artifacts: ${destination}`)
  return destination
}
