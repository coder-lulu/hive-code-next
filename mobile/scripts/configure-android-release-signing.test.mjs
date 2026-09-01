import { describe, expect, it } from 'vitest'
import { configureReleaseSigning, decodeKeystore } from './configure-android-release-signing.mjs'

const generatedGradle = `
android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
            minifyEnabled false
        }
    }
}
`

describe('Android release signing configuration', () => {
  it('adds an environment-backed release key and removes debug signing from release builds', () => {
    const result = configureReleaseSigning(generatedGradle)

    expect(result).toContain('HIVECODE_ANDROID_KEYSTORE_PATH')
    expect(result).toContain('signingConfig signingConfigs.release')
    expect(result.match(/signingConfig signingConfigs\.debug/g)).toHaveLength(1)
  })

  it('fails closed when the generated Gradle shape drifts', () => {
    expect(() =>
      configureReleaseSigning(
        generatedGradle.replace(
          'release {\n            signingConfig signingConfigs.debug',
          'release {\n            signingConfig null'
        )
      )
    ).toThrow('exactly one debug signing config')
    expect(() => configureReleaseSigning(configureReleaseSigning(generatedGradle))).toThrow(
      'already configured'
    )
  })

  it('rejects malformed or empty keystore material', () => {
    expect(() => decodeKeystore('')).toThrow()
    expect(() => decodeKeystore('not-base64')).toThrow()
    expect(decodeKeystore(Buffer.alloc(64, 7).toString('base64'))).toHaveLength(64)
  })
})
