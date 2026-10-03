import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sha256 } from './client-build-contract.mjs'

const execution = vi.hoisted(() => ({
  capture: vi.fn(),
  step: vi.fn(),
  nodeStep: vi.fn(),
  pnpmStep: vi.fn()
}))
vi.mock('./client-build-execution.mjs', () => execution)
import {
  buildIOS,
  iosPreflight,
  iosVersionIdentity,
  verifyIOSArtifacts
} from './client-build-ios.mjs'

const descriptors = Object.fromEntries(
  ['platform', 'arch'].map((key) => [key, Object.getOwnPropertyDescriptor(process, key)])
)
let context
let fixture
let captureOverride
let plistOverride
let archiveMetadata
let tarOverride
let signed
let simulatorSignature
const tarEntries = new Map()
const linkerSignature = `Executable=HiveCode
CodeDirectory v=20400 size=123 flags=0x20002(adhoc,linker-signed) hashes=1+0 location=embedded
Signature=adhoc
TeamIdentifier=not set`
const archivePathExtraction = [
  '-extract',
  'ApplicationProperties.ApplicationPath',
  'raw',
  '-expect',
  'string',
  '-o',
  '-'
]
const datedArchiveXML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CreationDate</key><date>2026-10-03T05:32:00Z</date>
<key>ApplicationProperties</key><dict>
<key>ApplicationPath</key><string>Applications/HiveCode.app</string>
</dict></dict></plist>`

function write(file, text = 'fixture') {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

function simulatorFile(file = 'HiveCode') {
  const app = 'ios/one/simulator-derived-data/Build/Products/Release-iphonesimulator/HiveCode.app'
  return join(context.work, app, file)
}

function simulatorSignatureProof() {
  const file = join(context.logs, 'ios-signature-iphonesimulator-verification.json')
  return JSON.parse(readFileSync(file, 'utf8'))
}

function app(directory, simulator) {
  const info = {
    CFBundleIdentifier: 'com.hivekernel.hivecode.mobile',
    CFBundleShortVersionString: '1.5.0',
    CFBundleVersion: '2',
    CFBundlePackageType: 'APPL',
    CFBundleExecutable: 'HiveCode',
    DTPlatformName: simulator ? 'iphonesimulator' : 'iphoneos',
    CFBundleSupportedPlatforms: [simulator ? 'iPhoneSimulator' : 'iPhoneOS']
  }
  write(join(directory, 'Info.plist'), JSON.stringify({ ...info, ...plistOverride }))
  write(join(directory, 'HiveCode'))
}

function installPods() {
  const ios = join(fixture, 'mobile/ios')
  mkdirSync(join(ios, 'HiveCode.xcworkspace'), { recursive: true })
  write(join(ios, 'Podfile.lock'), 'pinned-pods')
  write(join(ios, 'Pods/Manifest.lock'), 'pinned-pods')
  write(join(ios, 'HiveCode/Info.plist'))
}

beforeEach(() => {
  const logs = resolve('logs/all-platform-build/ios')
  mkdirSync(logs, { recursive: true })
  fixture = mkdtempSync(join(logs, 'fixture-'))
  context = {
    root: fixture,
    work: join(fixture, 'work'),
    attempt: 'one',
    logs: join(fixture, 'logs'),
    env: {},
    pkg: { version: '1.5.0-beta.24' },
    release: { ios: { xcode: '26.5' } },
    source: { commit: 'test-source', dirty: false },
    app: {
      expo: {
        version: '1.5.0-beta.24',
        ios: { bundleIdentifier: 'com.hivekernel.hivecode.mobile', buildNumber: '2' }
      }
    }
  }
  Object.defineProperty(process, 'platform', { ...descriptors.platform, value: 'darwin' })
  Object.defineProperty(process, 'arch', { ...descriptors.arch, value: 'arm64' })
  for (const sdk of ['iphoneos', 'iphonesimulator']) {
    mkdirSync(join(fixture, sdk))
  }
  captureOverride = undefined
  plistOverride = undefined
  archiveMetadata = {}
  tarOverride = undefined
  signed = false
  simulatorSignature = undefined
  tarEntries.clear()
  vi.clearAllMocks()
  execution.capture.mockImplementation(async (_context, program, args) => {
    const overridden = captureOverride?.(program, args)
    if (overridden !== undefined) {
      return overridden
    }
    if (program === 'xcodebuild') {
      return 'Xcode 26.5\nBuild version 17F42'
    }
    if (program === 'ruby' || program === 'pod') {
      return program === 'ruby' ? 'ruby 3.4.10' : '1.17.0'
    }
    if (program === 'xcrun' && args[0] === '--sdk') {
      return join(fixture, args[1])
    }
    if (program === '/usr/bin/plutil') {
      const text = readFileSync(args.at(-1), 'utf8')
      const dateBearing = text.includes('<date>')
      const metadata = dateBearing ? archiveMetadata : JSON.parse(text)
      if (args[0] === '-extract') {
        const value = dateBearing
          ? 'Applications/HiveCode.app'
          : metadata.ApplicationProperties?.ApplicationPath
        if (
          args[1] !== 'ApplicationProperties.ApplicationPath' ||
          args[2] !== 'raw' ||
          args[3] !== '-expect' ||
          args[4] !== 'string' ||
          typeof value !== 'string'
        ) {
          throw new Error('plutil: missing key or unexpected value type')
        }
        return value
      }
      if (dateBearing) {
        throw new Error('plutil: Invalid object in plist for JSON format')
      }
      return readFileSync(args.at(-1), 'utf8')
    }
    if (program === '/usr/bin/codesign') {
      if (args.at(-1).includes('simulator') && simulatorSignature !== undefined) {
        return args[0] === '--verify' ? '' : simulatorSignature
      }
      if (signed) {
        return 'Signature=adhoc'
      }
      throw new Error(`${program} failed: HiveCode.app: code object is not signed at all`)
    }
    if (program === 'xcrun' && args[0] === 'lipo') {
      return 'arm64'
    }
    if (program === 'xcrun' && args[0] === 'vtool') {
      return `Load command 10\n      cmd LC_BUILD_VERSION\n platform ${args.at(-1).includes('simulator') ? 'IOSSIMULATOR' : 'IOS'}`
    }
    if (program === '/usr/bin/tar') {
      return (tarOverride || tarEntries.get(args.at(-1))).join('\n')
    }
    throw new Error(`Unexpected capture ${program}: ${args.join(' ')}`)
  })
  execution.step.mockImplementation(async (_context, label, program, args) => {
    if (label === 'ios-pods') {
      installPods()
    } else if (label === 'ios-unsigned-archive') {
      const archive = args[args.indexOf('-archivePath') + 1]
      app(join(archive, 'Products/Applications/HiveCode.app'), false)
      write(
        join(archive, 'Info.plist'),
        archiveMetadata.CreationDate
          ? datedArchiveXML
          : JSON.stringify({
              ApplicationProperties: { ApplicationPath: 'Applications/HiveCode.app' },
              ...archiveMetadata
            })
      )
    } else if (label === 'ios-simulator-release') {
      app(
        join(
          args[args.indexOf('-derivedDataPath') + 1],
          'Build/Products/Release-iphonesimulator/HiveCode.app'
        ),
        true
      )
    } else if (program === '/usr/bin/tar') {
      const root = args.at(-1)
      const prefix = root.endsWith('.xcarchive')
        ? `${root}/Products/Applications/HiveCode.app`
        : root
      tarEntries.set(args[1], [
        `${root}/`,
        `${prefix}/Info.plist`,
        `${prefix}/HiveCode`,
        ...(root.endsWith('.xcarchive') ? [`${root}/Info.plist`] : [])
      ])
      write(args[1], `tar-${root}`)
    }
  })
})

afterEach(() => {
  for (const [key, descriptor] of Object.entries(descriptors)) {
    Object.defineProperty(process, key, descriptor)
  }
  rmSync(fixture, { recursive: true, force: true })
})

describe('iOS unsigned validation build', () => {
  it('provides all package-backed CocoaPods metadata for the bundled audio module', () => {
    const packageRoot = resolve(import.meta.dirname, '../../mobile/packages/expo-two-way-audio')
    const metadata = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
    for (const field of ['version', 'description', 'license', 'author', 'homepage']) {
      expect(metadata[field], `CocoaPods requires audio module ${field}`).toBeTypeOf('string')
      expect(metadata[field].trim().length).toBeGreaterThan(0)
    }
    expect(metadata.homepage).toBe('https://github.com/coder-lulu/hive-code-next')
    expect(metadata.license).toBe('MIT')
  })

  it('resolves the local audio pod source from its owned package homepage', () => {
    const podspec = readFileSync(
      resolve(
        import.meta.dirname,
        '../../mobile/packages/expo-two-way-audio/ios/ExpoTwoWayAudio.podspec'
      ),
      'utf8'
    )
    expect(podspec).toMatch(/s\.homepage\s*=\s*package\['homepage'\]/)
    expect(podspec).toMatch(/s\.source\s*=\s*\{\s*git:\s*"#\{package\['homepage'\]\}\.git"\s*\}/)
  })

  it.each(['1.5.0', '1.5.0-beta.24', '1.5.0-rc.2'])(
    'maps %s to an explicit numeric marketing version without changing the release',
    (version) => {
      context.pkg.version = context.app.expo.version = version
      expect(iosVersionIdentity(context)).toEqual({
        releaseVersion: version,
        marketingVersion: '1.5.0',
        buildNumber: '2',
        bundleIdentifier: 'com.hivekernel.hivecode.mobile'
      })
      expect(context.app.expo.version).toBe(version)
    }
  )

  it.each(['1.5', '1.5.0-preview.2', '../1.5.0', '1.5.0-beta.'])(
    'rejects invalid release identity %s',
    (version) => {
      context.pkg.version = context.app.expo.version = version
      expect(() => iosVersionIdentity(context)).toThrow('Invalid or inconsistent')
    }
  )

  it('refuses a non-macOS host before starting any commands', async () => {
    Object.defineProperty(process, 'platform', { ...descriptors.platform, value: 'win32' })
    await expect(iosPreflight(context)).rejects.toThrow('requires a macOS host')
    expect(execution.capture).not.toHaveBeenCalled()
  })

  it('requires the explicit pin and both selected Xcode SDKs', async () => {
    delete context.release.ios.xcode
    await expect(iosPreflight(context)).rejects.toThrow('pinned iOS Xcode')
    context.release.ios.xcode = '26.5'
    captureOverride = (program) => (program === 'xcodebuild' ? 'Xcode 16.4' : undefined)
    await expect(iosPreflight(context)).rejects.toThrow('selected toolchain differs')
    captureOverride = undefined
    rmSync(join(fixture, 'iphonesimulator'), { recursive: true })
    await expect(iosPreflight(context)).rejects.toThrow('missing the iphonesimulator SDK')
  })

  it('archives and builds Release without credentials, exporting only the two verified tarballs and receipt', async () => {
    const source = await buildIOS(context, true)
    const verified = await verifyIOSArtifacts(context, source)
    expect(verified.files.map((file) => file.name)).toEqual([
      'HiveCode-iOS-1.5.0-beta.24-unsigned-archive.tar.gz',
      'HiveCode-iOS-1.5.0-beta.24-simulator.tar.gz',
      'ios-build-verification.json'
    ])
    expect(verified.signature).toEqual({
      status: 'not-distribution-signed',
      archive: { status: 'unsigned' },
      simulator: { status: 'unsigned' },
      deviceInstallable: false,
      ipaProduced: false
    })
    expect(verified.ios.identity.marketingVersion).toBe('1.5.0')
    const builds = execution.step.mock.calls.filter((call) => call[2] === 'xcodebuild')
    expect(builds).toHaveLength(2)
    expect(builds[0][3]).toContain('archive')
    expect(builds[0][3]).toContain('generic/platform=iOS')
    expect(builds[1][3]).toContain('generic/platform=iOS Simulator')
    for (const call of builds) {
      expect(call[3]).toContain('Release')
      expect(call[3]).toContain('CODE_SIGNING_ALLOWED=NO')
      expect(call[3]).not.toContain('-allowProvisioningUpdates')
      expect(call[3]).not.toContain('-exportArchive')
    }
    expect(execution.nodeStep).toHaveBeenCalledWith(
      context,
      'ios-prebuild',
      join(fixture, 'mobile/node_modules/expo/bin/cli'),
      ['prebuild', '--platform', 'ios', '--no-install'],
      join(fixture, 'mobile')
    )
    expect(execution.step).toHaveBeenCalledWith(
      context,
      'ios-pods',
      'pod',
      ['install'],
      join(fixture, 'mobile/ios')
    )
    expect(execution.pnpmStep.mock.calls.map((call) => call[2])).toEqual([
      ['run', 'typecheck'],
      ['run', 'postinstall']
    ])
  })

  it('reuses prepared Pods offline and rejects missing or stale installations', async () => {
    await expect(buildIOS(context, false)).rejects.toThrow('dependencies are missing')
    installPods()
    write(join(fixture, 'mobile/ios/Pods/Manifest.lock'), 'wrong-pods')
    await expect(buildIOS(context, false)).rejects.toThrow('differ from Podfile.lock')
    installPods()
    await buildIOS(context, false)
    expect(execution.nodeStep).not.toHaveBeenCalled()
    expect(execution.step.mock.calls.some((call) => call[1] === 'ios-pods')).toBe(false)
  })

  it('reads the archive application path without converting its CreationDate to JSON', async () => {
    archiveMetadata = { CreationDate: '2026-10-03T05:32:00Z' }
    const source = await buildIOS(context, true)
    await expect(verifyIOSArtifacts(context, source)).resolves.toMatchObject({
      signature: { status: 'not-distribution-signed', deviceInstallable: false, ipaProduced: false }
    })
    expect(execution.capture).toHaveBeenCalledWith(context, '/usr/bin/plutil', [
      ...archivePathExtraction,
      join(context.work, 'ios/one/HiveCode.xcarchive/Info.plist')
    ])
  })

  it.each(['Applications/Other.app', '', 12])(
    'rejects an archive with invalid application path %s',
    async (value) => {
      archiveMetadata = { ApplicationProperties: { ApplicationPath: value } }
      await expect(buildIOS(context, true)).rejects.toThrow(
        typeof value === 'string'
          ? 'iOS xcarchive application path differs'
          : 'unexpected value type'
      )
    }
  )

  it.runIf(descriptors.platform.value === 'darwin')(
    'checks the date-bearing XML and binary archive contract with real macOS plutil',
    async () => {
      const { capture } = await vi.importActual('./client-build-execution.mjs')
      const nativeContext = { ...context, env: process.env }
      const xml = join(fixture, 'dated-archive.plist')
      const binary = join(fixture, 'dated-archive-binary.plist')
      write(xml, datedArchiveXML)
      await capture(nativeContext, '/usr/bin/plutil', ['-convert', 'binary1', '-o', binary, xml])
      for (const file of [xml, binary]) {
        await expect(
          capture(nativeContext, '/usr/bin/plutil', ['-convert', 'json', '-o', '-', file])
        ).rejects.toThrow('Invalid object in plist for JSON format')
        await expect(
          capture(nativeContext, '/usr/bin/plutil', [...archivePathExtraction, file])
        ).resolves.toBe('Applications/HiveCode.app')
      }
      write(
        xml,
        datedArchiveXML.replace(
          '<string>Applications/HiveCode.app</string>',
          '<integer>12</integer>'
        )
      )
      await expect(
        capture(nativeContext, '/usr/bin/plutil', [...archivePathExtraction, xml])
      ).rejects.toThrow('/usr/bin/plutil failed')
    }
  )

  it.each([
    ['bundle identity', { CFBundleIdentifier: 'wrong.app' }],
    ['marketing version', { CFBundleShortVersionString: '1.5.0-beta.24' }],
    ['build number', { CFBundleVersion: '3' }],
    ['device platform', { DTPlatformName: 'iphonesimulator' }]
  ])('rejects an app with incorrect %s', async (_label, override) => {
    plistOverride = override
    await expect(buildIOS(context, true)).rejects.toThrow('identity or platform validation failed')
  })

  it('rejects signed apps and retains unexpected codesign failures', async () => {
    signed = true
    await expect(buildIOS(context, true)).rejects.toThrow('application is signed')
    signed = false
    captureOverride = (program) => {
      if (program === '/usr/bin/codesign') {
        throw new Error('codesign: permission denied')
      }
    }
    await expect(buildIOS(context, true)).rejects.toThrow('permission denied')
  })

  it('verifies and records the simulator executable linker signature without signing or removing it', async () => {
    simulatorSignature = linkerSignature
    captureOverride = (program, args) => {
      if (
        program === '/usr/bin/codesign' &&
        args[0] === '--verify' &&
        /\.app[/\\]HiveCode$/.test(args.at(-1))
      ) {
        throw new Error(
          'codesign: code has no resources but signature indicates they must be present'
        )
      }
    }
    const source = await buildIOS(context, true)
    const verified = await verifyIOSArtifacts(context, source)
    const signature = {
      status: 'linker-adhoc',
      flags: '0x20002',
      authority: false,
      teamIdentifier: null,
      verified: true
    }
    expect(verified.ios.builds.archive).toMatchObject({
      unsigned: true,
      provisioned: false,
      signature: { status: 'unsigned' }
    })
    expect(verified.ios.builds.simulator).toMatchObject({
      unsigned: false,
      provisioned: false,
      signature
    })
    expect(verified.signature).toEqual({
      status: 'not-distribution-signed',
      archive: { status: 'unsigned' },
      simulator: signature,
      deviceInstallable: false,
      ipaProduced: false
    })
    const binary = simulatorFile()
    expect(execution.capture).toHaveBeenCalledWith(context, '/usr/bin/codesign', [
      '--display',
      '--verbose=4',
      binary
    ])
    const verification = execution.capture.mock.calls.find((call) => call[2][0] === '--verify')
    expect(verification[2].slice(0, -1)).toEqual(['--verify', '--strict'])
    expect(verification[2].at(-1)).not.toBe(binary)
    expect(verification[2].at(-1)).toContain(context.logs)
    expect(existsSync(verification[2].at(-1))).toBe(false)
    expect(simulatorSignatureProof()).toEqual({
      scope: 'standalone-mach-o',
      binarySha256: sha256(readFileSync(binary)),
      verified: true
    })
    expect(execution.step.mock.calls.some((call) => call[2] === '/usr/bin/codesign')).toBe(false)
  })

  it.each([
    ['certificate authority', `${linkerSignature}\nAuthority=Apple Development: Example`],
    ['team identifier', linkerSignature.replace('TeamIdentifier=not set', 'TeamIdentifier=ABCDE')],
    ['missing team evidence', linkerSignature.replace('\nTeamIdentifier=not set', '')],
    ['non-linker ad hoc', linkerSignature.replace('0x20002(adhoc,linker-signed)', '0x2(adhoc)')],
    ['distribution signature', linkerSignature.replace('Signature=adhoc', 'Signature size=123')],
    ['extra code flags', linkerSignature.replace('0x20002', '0x30002')],
    ['ambiguous signature', `${linkerSignature}\nSignature=adhoc`]
  ])('rejects simulator %s', async (_label, display) => {
    simulatorSignature = display
    await expect(buildIOS(context, true)).rejects.toThrow(
      'simulator signature is not linker ad hoc'
    )
    expect(execution.capture.mock.calls.some((call) => call[2][0] === '--verify')).toBe(false)
  })

  it('retains simulator executable signature verification failures', async () => {
    simulatorSignature = linkerSignature
    captureOverride = (program, args) => {
      if (program === '/usr/bin/codesign' && args[0] === '--verify') {
        throw new Error('codesign: invalid signature (code or signature have been modified)')
      }
    }
    await expect(buildIOS(context, true)).rejects.toThrow('invalid signature')
    const verification = execution.capture.mock.calls.find((call) => call[2][0] === '--verify')
    expect(existsSync(verification[2].at(-1))).toBe(false)
    expect(simulatorSignatureProof().verified).toBe(false)
  })

  it.each(['original', 'snapshot'])(
    'rejects %s bytes changed during executable verification',
    async (changed) => {
      simulatorSignature = linkerSignature
      captureOverride = (program, args) => {
        if (program === '/usr/bin/codesign' && args[0] === '--verify') {
          const binary = changed === 'snapshot' ? args.at(-1) : simulatorFile()
          write(binary, 'changed code pages')
          return ''
        }
      }
      await expect(buildIOS(context, true)).rejects.toThrow('executable bytes changed')
    }
  )

  it.each(['_CodeSignature', 'embedded.mobileprovision'])(
    'rejects simulator signing material %s even with a linker signature',
    async (file) => {
      simulatorSignature = linkerSignature
      const step = execution.step.getMockImplementation()
      execution.step.mockImplementation(async (...args) => {
        await step(...args)
        if (args[1] === 'ios-simulator-release') {
          write(simulatorFile(file))
        }
      })
      await expect(buildIOS(context, true)).rejects.toThrow('signing or provisioning material')
    }
  )

  it('rejects a forged simulator signature receipt and any ad hoc device receipt', async () => {
    simulatorSignature = linkerSignature
    const source = await buildIOS(context, true)
    const file = join(source, 'ios-build-verification.json')
    const receipt = JSON.parse(readFileSync(file, 'utf8'))
    const signature = receipt.builds.simulator.signature
    receipt.builds.simulator.signature = { ...signature, verified: false }
    write(file, JSON.stringify(receipt))
    await expect(verifyIOSArtifacts(context, source)).rejects.toThrow(
      'verification or checksum differs'
    )
    receipt.builds.simulator.signature = signature
    receipt.builds.archive.signature = signature
    receipt.builds.archive.unsigned = false
    write(file, JSON.stringify(receipt))
    await expect(verifyIOSArtifacts(context, source)).rejects.toThrow(
      'verification or checksum differs'
    )
  })

  it('rejects an actual simulator Mach-O masquerading as a device app', async () => {
    captureOverride = (program, args) =>
      program === 'xcrun' && args[0] === 'vtool' ? ' platform IOSSIMULATOR' : undefined
    await expect(buildIOS(context, true)).rejects.toThrow('Mach-O platform differs')
  })

  it('rejects missing architecture coverage', async () => {
    captureOverride = (program, args) =>
      program === 'xcrun' && args[0] === 'lipo' ? 'x86_64' : undefined
    await expect(buildIOS(context, true)).rejects.toThrow('architecture coverage differs')
  })

  it('rejects unsafe tar entries instead of publishing them', async () => {
    tarOverride = ['../other.app/Info.plist']
    await expect(buildIOS(context, true)).rejects.toThrow('unsafe path')
  })

  it('binds delivery to the source, metadata and original tar bytes', async () => {
    const source = await buildIOS(context, true)
    context.source.commit = 'different-source'
    await expect(verifyIOSArtifacts(context, source)).rejects.toThrow(
      'source or validation contract differs'
    )
    context.source.commit = 'test-source'
    write(join(source, 'HiveCode-iOS-1.5.0-beta.24-simulator.tar.gz'), 'modified')
    await expect(verifyIOSArtifacts(context, source)).rejects.toThrow('checksum differs')
  })
})
