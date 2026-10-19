#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '../..')
const fail = (reason) => {
  throw new Error(`Android signing verification: ${reason}`)
}

export function normalizeExpectedFingerprint(value) {
  if (typeof value !== 'string' || !value.trim()) {
    fail('expected fingerprint missing')
  }
  const fingerprint = value.trim().replaceAll(':', '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) {
    fail('expected fingerprint invalid')
  }
  return fingerprint
}

export function parseApkFingerprint(output) {
  const signers = [...output.matchAll(/^Signer #(\d+)\b/gm)]
  const digestLines = [...output.matchAll(/^Signer #\d+ certificate SHA-256 digest:/gm)]
  const digests = [
    ...output.matchAll(/^Signer #(\d+) certificate SHA-256 digest: ([0-9a-fA-F]{64})\r?$/gm)
  ]
  if (
    signers.length === 0 ||
    signers.some((match) => match[1] !== '1') ||
    digestLines.length !== 1 ||
    digests.length !== 1 ||
    digests[0][1] !== '1'
  ) {
    fail('APK signer output invalid')
  }
  return digests[0][2].toLowerCase()
}

export function verifyAndroidReleaseSigning(
  mode,
  apkPath,
  { env = process.env, run, exists = existsSync } = {}
) {
  if (!['key', 'apk'].includes(mode) || (mode === 'key' && apkPath)) {
    fail('usage: key | apk [apkPath]')
  }
  const expected = normalizeExpectedFingerprint(env.HIVECODE_ANDROID_SIGNING_FINGERPRINT)
  if (typeof run !== 'function') {
    fail('process-host runner missing')
  }
  if (!env.JAVA_HOME) {
    fail('JAVA_HOME missing')
  }
  const java = resolve(env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  if (!exists(java)) {
    fail('Java executable missing')
  }
  let args
  if (mode === 'key') {
    for (const name of [
      'HIVECODE_ANDROID_KEYSTORE_PATH',
      'HIVECODE_ANDROID_KEYSTORE_PASSWORD',
      'HIVECODE_ANDROID_KEY_ALIAS',
      'HIVECODE_ANDROID_KEY_PASSWORD'
    ]) {
      if (typeof env[name] !== 'string' || env[name].length === 0) {
        fail(`key configuration missing: ${name}`)
      }
    }
    const probe = resolve(root, 'config/scripts/AndroidSigningProbe.java')
    if (!exists(probe)) {
      fail('key probe missing')
    }
    args = [probe]
  } else {
    if (!env.ANDROID_HOME) {
      fail('ANDROID_HOME missing')
    }
    let pin
    try {
      pin = JSON.parse(readFileSync(resolve(root, 'config/client-build.json'), 'utf8')).android
        .buildTools
    } catch {
      fail('build-tools configuration invalid')
    }
    if (typeof pin !== 'string' || !/^\d+\.\d+\.\d+$/.test(pin)) {
      fail('build-tools pin invalid')
    }
    const jar = resolve(env.ANDROID_HOME, 'build-tools', pin, 'lib/apksigner.jar')
    if (!exists(jar)) {
      fail('pinned SDK apksigner.jar missing')
    }
    const apk = resolve(
      apkPath ?? resolve(root, 'mobile/android/app/build/outputs/apk/release/app-release.apk')
    )
    if (!exists(apk)) {
      fail('APK file missing')
    }
    args = ['-jar', jar, 'verify', '--verbose', '--print-certs', apk]
  }
  let result
  try {
    result = run({
      program: java,
      args,
      cwd: root,
      env,
      timeoutMs: 120_000,
      maxOutputBytes: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch {
    fail(`${mode} tool invocation failed`)
  }
  if (result?.timedOut || result?.outputTruncated || result?.signal || result?.code !== 0) {
    fail(`${mode} tool verification failed`)
  }
  const output = String(result.stdout ?? '')
  let actual
  if (mode === 'key') {
    actual = output.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(actual)) {
      fail('key probe output invalid')
    }
  } else {
    actual = parseApkFingerprint(output)
  }
  if (actual !== expected) {
    fail(`${mode} fingerprint mismatch`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length > 4) {
      fail('usage: key | apk [apkPath]')
    }
    const { loadClientBuildProcessHost } =
      await import('../../config/scripts/client-build-process-host.mjs')
    const { runProcessSync } = await loadClientBuildProcessHost()
    verifyAndroidReleaseSigning(process.argv[2], process.argv[3], { run: runProcessSync })
    console.log(`Android signing verification: ${process.argv[2]} PASS`)
  } catch (error) {
    const message =
      error instanceof Error && error.message.startsWith('Android signing verification: ')
        ? error.message
        : 'Android signing verification: unexpected failure'
    console.error(message)
    process.exitCode = 1
  }
}
