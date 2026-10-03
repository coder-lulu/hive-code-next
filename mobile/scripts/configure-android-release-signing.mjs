#!/usr/bin/env node

import { chmod, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const RELEASE_SIGNING_BLOCK = `
        release {
            def hiveCodeStorePath = System.getenv("HIVECODE_ANDROID_KEYSTORE_PATH")
            def hiveCodeStorePassword = System.getenv("HIVECODE_ANDROID_KEYSTORE_PASSWORD")
            def hiveCodeKeyAlias = System.getenv("HIVECODE_ANDROID_KEY_ALIAS")
            def hiveCodeKeyPassword = System.getenv("HIVECODE_ANDROID_KEY_PASSWORD")
            if (!hiveCodeStorePath || !hiveCodeStorePassword || !hiveCodeKeyAlias || !hiveCodeKeyPassword) {
                // Gradle configures the release variant even when building only Debug.
                // Enforce credentials once the requested task graph actually includes Release.
                gradle.taskGraph.whenReady { graph ->
                    if (graph.allTasks.any { task -> task.project.path == ':app' && task.name.toLowerCase().contains('release') }) {
                        throw new GradleException("HiveCode Android release signing environment is incomplete")
                    }
                }
            } else {
                storeFile file(hiveCodeStorePath)
                storePassword hiveCodeStorePassword
                keyAlias hiveCodeKeyAlias
                keyPassword hiveCodeKeyPassword
            }
        }
`

function requiredEnvironment(name, environment) {
  const value = String(environment[name] ?? '').trim()
  if (!value) {
    throw new Error(`${name} is required for Android release signing`)
  }
  return value
}

function findBlock(source, name, fromIndex = 0) {
  const pattern = new RegExp(`\\b${name}\\s*\\{`, 'g')
  pattern.lastIndex = fromIndex
  const match = pattern.exec(source)
  if (!match) {
    throw new Error(`Generated Android build.gradle is missing ${name}`)
  }
  const open = source.indexOf('{', match.index)
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') {
      depth += 1
    }
    if (source[index] === '}') {
      depth -= 1
    }
    if (depth === 0) {
      return { open, close: index }
    }
  }
  throw new Error(`Generated Android build.gradle has an unterminated ${name} block`)
}

export function configureReleaseSigning(source) {
  if (source.includes('HIVECODE_ANDROID_KEYSTORE_PATH')) {
    const buildTypes = findBlock(source, 'buildTypes')
    const release = findBlock(source, 'release', buildTypes.open)
    if (
      release.close > buildTypes.close ||
      !source.includes(RELEASE_SIGNING_BLOCK) ||
      !/signingConfig\s+signingConfigs\.release/.test(source.slice(release.open, release.close)) ||
      /signingConfig\s+signingConfigs\.debug/.test(source.slice(release.open, release.close))
    ) {
      throw new Error('Existing HiveCode signing configuration has drifted')
    }
    return source
  }
  const signingConfigs = findBlock(source, 'signingConfigs')
  let patched = `${source.slice(0, signingConfigs.close)}${RELEASE_SIGNING_BLOCK}${source.slice(signingConfigs.close)}`

  const buildTypes = findBlock(patched, 'buildTypes')
  const release = findBlock(patched, 'release', buildTypes.open)
  if (release.close > buildTypes.close) {
    throw new Error('Generated Android release build type is outside buildTypes')
  }
  const releaseBody = patched.slice(release.open, release.close + 1)
  const debugSigningPattern = /signingConfig\s+signingConfigs\.debug/g
  const matches = releaseBody.match(debugSigningPattern) ?? []
  if (matches.length !== 1) {
    throw new Error(
      'Generated Android release build type must use exactly one debug signing config'
    )
  }
  const signedReleaseBody = releaseBody.replace(
    debugSigningPattern,
    'signingConfig signingConfigs.release'
  )
  patched = `${patched.slice(0, release.open)}${signedReleaseBody}${patched.slice(release.close + 1)}`
  return patched
}

export function decodeKeystore(value) {
  const normalized = value.replace(/\s+/g, '')
  if (!normalized || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new Error('HIVECODE_ANDROID_KEYSTORE_BASE64 is not valid base64')
  }
  const bytes = Buffer.from(normalized, 'base64')
  if (
    bytes.length < 32 ||
    bytes.toString('base64').replace(/=+$/, '') !== normalized.replace(/=+$/, '')
  ) {
    throw new Error('HIVECODE_ANDROID_KEYSTORE_BASE64 is invalid or empty')
  }
  return bytes
}

export async function main(environment = process.env) {
  const projectRoot = resolve(import.meta.dirname, '..')
  const gradlePath = resolve(
    environment.HIVECODE_ANDROID_BUILD_GRADLE ?? `${projectRoot}/android/app/build.gradle`
  )
  const keystorePath = resolve(requiredEnvironment('HIVECODE_ANDROID_KEYSTORE_PATH', environment))
  const keystore = decodeKeystore(
    requiredEnvironment('HIVECODE_ANDROID_KEYSTORE_BASE64', environment)
  )
  requiredEnvironment('HIVECODE_ANDROID_KEYSTORE_PASSWORD', environment)
  requiredEnvironment('HIVECODE_ANDROID_KEY_ALIAS', environment)
  requiredEnvironment('HIVECODE_ANDROID_KEY_PASSWORD', environment)

  const source = await readFile(gradlePath, 'utf8')
  await writeFile(gradlePath, configureReleaseSigning(source), 'utf8')
  await writeFile(keystorePath, keystore, { mode: 0o600 })
  await chmod(keystorePath, 0o600)
  console.log('Configured generated Android release build for the HiveCode signing key')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
