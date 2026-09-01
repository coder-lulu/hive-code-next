import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const packageRoot = resolve(import.meta.dirname, '../../packages/expo-hivecode-updater')

describe('Android updater transport boundary', () => {
  it('rejects redirects and enforces streaming byte and digest limits natively', () => {
    const kotlin = readFileSync(
      resolve(
        packageRoot,
        'android/src/main/java/expo/modules/hivecodeupdater/ExpoHiveCodeUpdaterModule.kt'
      ),
      'utf8'
    )
    expect(kotlin).toContain('instanceFollowRedirects = false')
    expect(kotlin).toContain('total <= expectedSize && total <= maximumApkBytes')
    expect(kotlin).toContain('total == expectedSize')
    expect(kotlin).toContain('MessageDigest.getInstance("SHA-256")')
    expect(kotlin).toContain('source.host.equals(origin.host')
  })

  it('serves only updater cache files through a non-exported read-only provider', () => {
    const manifest = readFileSync(
      resolve(packageRoot, 'android/src/main/AndroidManifest.xml'),
      'utf8'
    )
    const paths = readFileSync(
      resolve(packageRoot, 'android/src/main/res/xml/hivecode_updater_file_paths.xml'),
      'utf8'
    )
    expect(manifest).toContain('android:exported="false"')
    expect(manifest).toContain('android:grantUriPermissions="true"')
    expect(paths).toContain('path="hivecode-updates/"')
  })
})
