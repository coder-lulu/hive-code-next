import { readFileSync } from 'node:fs'
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
    expect(electronBuilderConfig.publish).toBeUndefined()
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
