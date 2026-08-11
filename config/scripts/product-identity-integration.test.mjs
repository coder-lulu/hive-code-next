import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const manifest = JSON.parse(
  readFileSync(path.join(repoRoot, 'config', 'product', 'hivecode.product.json'), 'utf8')
)
const packageManifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const mobileApp = JSON.parse(readFileSync(path.join(repoRoot, 'mobile', 'app.json'), 'utf8'))
const mobileFastfile = readFileSync(path.join(repoRoot, 'mobile', 'fastlane', 'Fastfile'), 'utf8')
const homebrewBumpWorkflow = readFileSync(
  path.join(repoRoot, '.github', 'workflows', 'homebrew-bump.yml'),
  'utf8'
)
const localBuildContract = JSON.parse(
  readFileSync(
    path.join(repoRoot, 'src', 'shared', 'local-build-compatibility-contract.json'),
    'utf8'
  )
)
const electronBuilderConfig = require('../electron-builder.config.cjs')
const macOSComputerUseHelper = readFileSync(
  path.join(
    repoRoot,
    'native',
    'computer-use-macos',
    'Sources',
    'OrcaComputerUseMacOS',
    'main.swift'
  ),
  'utf8'
)

describe('HiveCode product identity integration', () => {
  it('fails closed when official HiveCode public links are not configured', () => {
    expect(manifest.publicLinks).toEqual({
      website: null,
      documentation: null,
      support: null,
      community: null,
      social: null,
      desktopDownload: null,
      androidDownload: null,
      iosDownload: null,
      privacyPolicy: null,
      termsOfService: null
    })
  })

  it('locks the renderer to the approved HiveCode product logo', () => {
    expect(manifest.branding).toEqual({
      logoAsset: 'resources/product-logo.png',
      logoSha256: '337e995f0c3f8d08ec420bc8f133290de51504517e3e5f995d814987d57be6b1'
    })

    const logoPath = path.join(repoRoot, 'resources', 'product-logo.png')
    expect(existsSync(logoPath)).toBe(true)
    if (!existsSync(logoPath)) {
      return
    }
    expect(createHash('sha256').update(readFileSync(logoPath)).digest('hex')).toBe(
      manifest.branding.logoSha256
    )

    const rendererBrandPath = path.join(repoRoot, 'src', 'renderer', 'src', 'product-brand.ts')
    expect(existsSync(rendererBrandPath)).toBe(true)
    if (!existsSync(rendererBrandPath)) {
      return
    }
    const rendererBrand = readFileSync(rendererBrandPath, 'utf8')
    expect(rendererBrand).toContain('../../../resources/product-logo.png')

    const logoConsumers = [
      'src/renderer/src/App.tsx',
      'src/renderer/src/components/Landing.tsx',
      'src/renderer/src/components/onboarding/OnboardingFlow.tsx',
      'src/renderer/src/components/settings/orca-logo-settings-icon.tsx',
      'src/renderer/src/components/sidebar/SidebarSettingsHelpMenu.tsx',
      'src/renderer/src/components/stats/ShareUsageCard.tsx',
      'src/renderer/src/components/mobile/slides/HomeSlide.tsx'
    ]
    for (const relativePath of logoConsumers) {
      const source = readFileSync(path.join(repoRoot, relativePath), 'utf8')
      expect(source, relativePath).toContain('@/product-brand')
      expect(source, relativePath).not.toContain('resources/logo.svg')
      expect(source, relativePath).not.toContain('function OrcaLogo()')
    }
  })

  it('locks desktop and mobile distribution icons to the approved HiveCode exports', () => {
    const approvedAssetHashes = new Map([
      [
        'resources/build/icon.icns',
        '6fbbfe438fc9864f8f2599cb6c91d1336aaee41cb851a786807bdf079d4395dc'
      ],
      [
        'resources/build/icon.ico',
        'af3d36802e35fabee79feba55b20414b73f05f4b7bad3820870ff049e767389d'
      ],
      [
        'resources/build/icon.png',
        'cc6222a53654f2df5b0862b5f4d232d6dd345af84beff98958866a3970bf3157'
      ],
      ['resources/icon.png', 'ab3f21d4beb536533bcd9f2f51a458605525f5c2dffc7f7c92d99692fcec8829'],
      [
        'resources/icon-dev.png',
        'ab3f21d4beb536533bcd9f2f51a458605525f5c2dffc7f7c92d99692fcec8829'
      ],
      [
        'resources/tray/hivecode-menu-barTemplate.png',
        'ea57c7291a89afbdf4874eeb0e1cc93494cd40983bbde61e5c98a597a2c1f734'
      ],
      [
        'resources/tray/hivecode-menu-barTemplate@2x.png',
        '1aaf3c596e75211ee9681fecc5db86e881b667190cadcad150346a9056dc5e04'
      ],
      [
        'mobile/assets/icon.png',
        'cc6222a53654f2df5b0862b5f4d232d6dd345af84beff98958866a3970bf3157'
      ],
      [
        'mobile/assets/adaptive-icon.png',
        'cc6222a53654f2df5b0862b5f4d232d6dd345af84beff98958866a3970bf3157'
      ],
      [
        'mobile/assets/splash-icon.png',
        '337e995f0c3f8d08ec420bc8f133290de51504517e3e5f995d814987d57be6b1'
      ],
      [
        'mobile/assets/favicon.png',
        'dda01628148bc6b33e37506a61dcb24e25cd126aab6d9aefcfe12c9fef0c445f'
      ]
    ])
    for (const [relativePath, expectedHash] of approvedAssetHashes) {
      const assetPath = path.join(repoRoot, relativePath)
      expect(existsSync(assetPath), relativePath).toBe(true)
      expect(createHash('sha256').update(readFileSync(assetPath)).digest('hex'), relativePath).toBe(
        expectedHash
      )
    }

    expect(mobileApp.expo.splash.backgroundColor).toBe('#FBF7F0')
    expect(mobileApp.expo.android.adaptiveIcon.backgroundColor).toBe('#FBF7F0')
    const splashPlugin = mobileApp.expo.plugins.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen'
    )
    expect(splashPlugin?.[1]?.backgroundColor).toBe('#FBF7F0')

    const mobileLogo = readFileSync(
      path.join(repoRoot, 'mobile', 'src', 'components', 'OrcaLogo.tsx'),
      'utf8'
    )
    expect(mobileLogo).toContain("require('../../assets/icon.png')")
    expect(mobileLogo).not.toContain('react-native-svg')
  })

  it('locks future icon regeneration to the approved HiveCode source asset', () => {
    const iconSourceManifestPath = path.join(
      repoRoot,
      'resources',
      'icon-source',
      'icon.icon',
      'icon.json'
    )
    const iconSourceManifest = JSON.parse(readFileSync(iconSourceManifestPath, 'utf8'))
    expect(iconSourceManifest.groups[0].layers[0]['image-name']).toBe('product-logo.png')

    const iconSourceAssetPath = path.join(
      repoRoot,
      'resources',
      'icon-source',
      'icon.icon',
      'Assets',
      'product-logo.png'
    )
    expect(existsSync(iconSourceAssetPath)).toBe(true)
    if (existsSync(iconSourceAssetPath)) {
      expect(createHash('sha256').update(readFileSync(iconSourceAssetPath)).digest('hex')).toBe(
        'cc6222a53654f2df5b0862b5f4d232d6dd345af84beff98958866a3970bf3157'
      )
    }

    for (const legacyLogoPath of [
      'resources/logo.svg',
      'resources/icon-source/icon.icon/Assets/logo.svg',
      'resources/app-icons/orca-watercolor.png',
      'resources/app-icons/orca-blue.png',
      'resources/tray/orca-menu-barTemplate.png',
      'resources/tray/orca-menu-barTemplate@2x.png'
    ]) {
      expect(existsSync(path.join(repoRoot, legacyLogoPath)), legacyLogoPath).toBe(false)
    }

    const iconConsumers = [
      'src/main/app-icon.ts',
      'src/main/tray/system-tray.ts',
      'src/renderer/src/components/settings/AppIconSelector.tsx'
    ].map((relativePath) => readFileSync(path.join(repoRoot, relativePath), 'utf8'))
    expect(iconConsumers.join('\n')).not.toContain('resources/app-icons/orca-')
    expect(iconConsumers.join('\n')).not.toContain('orca-menu-barTemplate')

    const shareCardUtils = readFileSync(
      path.join(repoRoot, 'src', 'renderer', 'src', 'components', 'stats', 'share-card-utils.tsx'),
      'utf8'
    )
    expect(shareCardUtils).not.toContain('viewBox="0 0 318.60232 202.66667"')
    expect(shareCardUtils).not.toContain('function OrcaLogo()')
  })

  it('uses the approved HiveKernel reverse-DNS identity across desktop packaging', () => {
    expect(manifest).toMatchObject({
      displayName: 'HiveCode',
      shortName: 'HiveCode',
      desktop: {
        appId: 'com.hivekernel.hivecode.desktop',
        executableName: 'HiveCode',
        publisher: null,
        updateChannel: null
      }
    })
    expect(electronBuilderConfig).toMatchObject({
      appId: manifest.desktop.appId,
      productName: manifest.displayName,
      win: { executableName: manifest.desktop.executableName }
    })
    expect(localBuildContract.appId).toBe(manifest.desktop.appId)
  })

  it('uses the approved HiveCode identity in the Expo app', () => {
    expect(manifest.mobile).toEqual({
      bundleId: 'com.hivekernel.hivecode.mobile',
      packageId: 'com.hivekernel.hivecode.mobile'
    })
    expect(mobileApp.expo).toMatchObject({
      name: manifest.displayName,
      slug: 'hivecode-mobile',
      ios: { bundleIdentifier: manifest.mobile.bundleId },
      android: { package: manifest.mobile.packageId }
    })
  })

  it('uses the Expo-generated HiveCode project identity in Fastlane', () => {
    expect(mobileFastfile).toContain('"ios", "HiveCode.xcworkspace"')
    expect(mobileFastfile).toContain('SCHEME = "HiveCode"')
    expect(mobileFastfile).toContain('output_name: "HiveCode.ipa"')
    expect(mobileFastfile).not.toContain('Orca.xcworkspace')
  })

  it('registers hivecode and orca deep-link protocols in the macOS electron-builder config', () => {
    expect(electronBuilderConfig.mac.protocols).toBeDefined()
    expect(electronBuilderConfig.mac.protocols).toHaveLength(1)
    const [protocol] = electronBuilderConfig.mac.protocols
    expect(protocol.name).toBe('HiveCode')
    expect(protocol.schemes).toContain(manifest.schemes.primary)
    for (const alias of manifest.schemes.aliases) {
      expect(protocol.schemes).toContain(alias)
    }
  })

  it('does not publish HiveCode builds through the upstream Orca release channel', () => {
    expect(manifest.desktop.updateChannel).toBeNull()
    expect(electronBuilderConfig.publish).toBeNull()
    const bumpJob = homebrewBumpWorkflow.slice(
      homebrewBumpWorkflow.indexOf('  bump-cask:'),
      homebrewBumpWorkflow.indexOf('    permissions:')
    )
    expect(bumpJob).toContain("github.repository == 'stablyai/orca' &&")
  })

  it('prevents package metadata from becoming an implicit upstream publication target', () => {
    expect(packageManifest.private).toBe(true)
    expect(packageManifest).not.toHaveProperty('homepage')
    expect(packageManifest).not.toHaveProperty('repository')
  })

  it('authorizes the approved desktop and dev bundle identities in the macOS helper', () => {
    expect(macOSComputerUseHelper).toContain(`bundleId == "${manifest.desktop.appId}"`)
    expect(macOSComputerUseHelper).toContain(`bundleId == "${manifest.desktop.appId}.dev"`)
    expect(macOSComputerUseHelper).toContain(`bundleId.hasPrefix("${manifest.desktop.appId}.dev.")`)
    expect(macOSComputerUseHelper).toContain('bundleId == "com.stablyai.orca"')
  })
})
