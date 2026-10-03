import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { PNG } = require('pngjs')
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

function readPngAsset(relativePath) {
  return PNG.sync.read(readFileSync(path.join(repoRoot, relativePath)))
}

function opaqueBounds(png, threshold = 16) {
  let minX = png.width
  let minY = png.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      if (png.data[(y * png.width + x) * 4 + 3] <= threshold) {
        continue
      }
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  return { width: maxX - minX + 1, height: maxY - minY + 1 }
}

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
      logoSha256: '46325bf9d05755d2b412f0a2e720cb1944d69abb7f6e3c07b59ed304f4e81950'
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
      'src/renderer/src/components/stats/ShareUsageCard.tsx'
    ]
    for (const relativePath of logoConsumers) {
      const source = readFileSync(path.join(repoRoot, relativePath), 'utf8')
      expect(source, relativePath).toContain('@/product-brand')
      expect(source, relativePath).not.toContain('resources/logo.svg')
      expect(source, relativePath).not.toContain('function OrcaLogo()')
    }
    expect(
      existsSync(path.join(repoRoot, 'src/renderer/src/components/mobile/slides/HomeSlide.tsx'))
    ).toBe(false)
  })

  it('locks desktop and mobile distribution icons to the approved HiveCode exports', () => {
    const approvedAssetHashes = new Map([
      [
        'resources/build/icon.icns',
        '35771887728489b22cd4dbbbb2d9b925c900e9e3cd5a3aedcbe4e7cf255f57ab'
      ],
      [
        'resources/build/icon.ico',
        'e194b6e13524972d56c99aaa468d7938d4cc93e18ea5671dd4c15791b7a659b9'
      ],
      [
        'resources/build/icon.png',
        'b7a69da0450fa36d754e492b11a567122e0b1d19dcd03f013837fba1083950ea'
      ],
      ['resources/icon.png', '3175a4ae96c2e53e74f09d7dfcd8d914035fdec185d565a70c877ae8a9790c8e'],
      [
        'resources/icon-dev.png',
        '3175a4ae96c2e53e74f09d7dfcd8d914035fdec185d565a70c877ae8a9790c8e'
      ],
      [
        'resources/tray/hivecode-menu-barTemplate.png',
        '63a6070d3a47b8fdd7abd0582cdf106b998c8f6789163bbe3a54032a74b5bf41'
      ],
      [
        'resources/tray/hivecode-menu-barTemplate@2x.png',
        '0e0f0677ccedc14aeefb1dc1067c2fb85dd22c187d2aa258bc77877e6251c1d5'
      ],
      [
        'mobile/assets/icon.png',
        '788759ae38ce6de76a5a774e3aeb317421bcf266eeed11a8eddd4c8e5b3e269d'
      ],
      [
        'mobile/assets/adaptive-icon.png',
        'e29b1fd66f0061d41bf26befef5475cc7446b0a484501efed59ec7d6d3e13fbe'
      ],
      [
        'mobile/assets/splash-icon.png',
        '64fc8a02e7eca4b8a84dda59d4078d7a9d4b3b842ac3957a9af8b19671b43206'
      ],
      [
        'mobile/assets/favicon.png',
        'c6cbf2769698e88b6cb4a7c14558013ae5879ee369a4e161d6c7614e33a0fd2a'
      ]
    ])
    for (const [relativePath, expectedHash] of approvedAssetHashes) {
      const assetPath = path.join(repoRoot, relativePath)
      expect(existsSync(assetPath), relativePath).toBe(true)
      expect(createHash('sha256').update(readFileSync(assetPath)).digest('hex'), relativePath).toBe(
        expectedHash
      )
    }

    const desktopIcon = readPngAsset('resources/build/icon.png')
    expect([desktopIcon.width, desktopIcon.height]).toEqual([1024, 1024])
    expect(desktopIcon.data[3]).toBe(0)

    const mobileIcon = readPngAsset('mobile/assets/icon.png')
    expect([mobileIcon.width, mobileIcon.height]).toEqual([1024, 1024])
    expect(mobileIcon.data.every((value, index) => index % 4 !== 3 || value === 255)).toBe(true)

    const adaptiveIcon = readPngAsset('mobile/assets/adaptive-icon.png')
    const adaptiveBounds = opaqueBounds(adaptiveIcon)
    expect(Math.max(adaptiveBounds.width, adaptiveBounds.height) / adaptiveIcon.width).toBeLessThan(
      0.62
    )
    expect(adaptiveIcon.data[3]).toBe(0)

    const productLogo = readPngAsset('resources/product-logo.png')
    expect([productLogo.width, productLogo.height]).toEqual([512, 512])
    expect(productLogo.data[3]).toBe(0)

    expect(mobileApp.expo.splash.backgroundColor).toBe('#EAF2FF')
    expect(mobileApp.expo.android.adaptiveIcon.backgroundColor).toBe('#EAF2FF')
    const splashPlugin = mobileApp.expo.plugins.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen'
    )
    expect(splashPlugin?.[1]?.backgroundColor).toBe('#EAF2FF')

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
        '788759ae38ce6de76a5a774e3aeb317421bcf266eeed11a8eddd4c8e5b3e269d'
      )
    }

    const masterLogoPath = path.join(
      repoRoot,
      'resources',
      'icon-source',
      'hivecode-logo-master.png'
    )
    expect(createHash('sha256').update(readFileSync(masterLogoPath)).digest('hex')).toBe(
      '4978f3611915cdd98fb97766ba2938d54c5f378f9075e233bc418c0d13372ca8'
    )

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
        updateChannel: 'beta'
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
    expect(manifest.desktop.updateChannel).toBe('beta')
    expect(electronBuilderConfig.publish).toBeNull()
    const bumpJob = homebrewBumpWorkflow.slice(
      homebrewBumpWorkflow.indexOf('  bump-cask:'),
      homebrewBumpWorkflow.indexOf('    permissions:')
    )
    expect(bumpJob).toContain("github.repository == 'stablyai/orca' &&")
  })

  it('prevents package metadata from becoming an implicit upstream publication target', () => {
    expect(packageManifest.private).toBe(true)
    expect(packageManifest.homepage).toBe('https://github.com/coder-lulu/hive-code-next')
    expect(packageManifest).not.toHaveProperty('repository')
  })

  it('authorizes the approved desktop and dev bundle identities in the macOS helper', () => {
    expect(macOSComputerUseHelper).toContain(`bundleId == "${manifest.desktop.appId}"`)
    expect(macOSComputerUseHelper).toContain(`bundleId == "${manifest.desktop.appId}.dev"`)
    expect(macOSComputerUseHelper).toContain(`bundleId.hasPrefix("${manifest.desktop.appId}.dev.")`)
    expect(macOSComputerUseHelper).toContain('bundleId == "com.stablyai.orca"')
  })
})
