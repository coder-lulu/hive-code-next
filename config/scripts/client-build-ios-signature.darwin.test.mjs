import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { join, resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { capture } from './client-build-execution.mjs'
import { sha256 } from './client-build-contract.mjs'
import { verifyIOSExecutableSignature } from './client-build-ios.mjs'

const marker = 'LINKER_SIGNATURE_PROBE_BOUND_DATA'
const expectedLinkerSignature = {
  status: 'linker-adhoc',
  flags: '0x20002',
  authority: false,
  teamIdentifier: null,
  verified: true
}
const info = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>org.example.signatureprobe</string>
<key>CFBundleName</key><string>Probe</string>
<key>CFBundleExecutable</key><string>Probe</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>1.0.0</string>
</dict></plist>`
let context
let directory
const binaries = {}

describe.runIf(process.platform === 'darwin')(
  'real iOS linker Mach-O signature verification',
  () => {
    beforeAll(async () => {
      const logs = resolve('logs/client-build-ci')
      mkdirSync(logs, { recursive: true })
      directory = mkdtempSync(join(logs, 'ios-native-signature-'))
      context = { root: directory, logs: directory, env: process.env }
      const source = join(directory, 'probe.c')
      writeFileSync(
        source,
        `const volatile char probe[] = "${marker}";\nint main(void) { return probe[0]; }\n`
      )
      for (const [platform, sdk, target, supported] of [
        ['simulator', 'iphonesimulator', 'arm64-apple-ios15.1-simulator', 'iPhoneSimulator'],
        ['device', 'iphoneos', 'arm64-apple-ios15.1', 'iPhoneOS']
      ]) {
        const app = join(directory, `${platform}.app`)
        mkdirSync(app)
        writeFileSync(
          join(app, 'Info.plist'),
          info.replace(
            '</dict></plist>',
            `<key>CFBundleSupportedPlatforms</key><array><string>${supported}</string></array></dict></plist>`
          )
        )
        const sdkPath = await capture(context, 'xcrun', ['--sdk', sdk, '--show-sdk-path'])
        binaries[platform] = join(app, 'Probe')
        await capture(context, 'xcrun', [
          '--sdk',
          sdk,
          'clang',
          '-target',
          target,
          '-isysroot',
          sdkPath,
          source,
          '-o',
          binaries[platform]
        ])
        expect(await capture(context, 'xcrun', ['lipo', '-archs', binaries[platform]])).toBe(
          'arm64'
        )
        expect(
          await capture(context, 'xcrun', ['vtool', '-show-build', binaries[platform]])
        ).toMatch(platform === 'device' ? /platform\s+IOS\s/ : /platform\s+IOSSIMULATOR\s/)
      }
      writeFileSync(
        join(directory, 'xcode-version.log'),
        `${await capture(context, 'xcodebuild', ['-version'])}\n`
      )
    }, 120_000)

    it('reproduces bundle resource failure and verifies the identical standalone linker bytes', async () => {
      const binary = binaries.simulator
      const original = readFileSync(binary)
      const display = await capture(context, '/usr/bin/codesign', [
        '--display',
        '--verbose=4',
        binary
      ])
      expect(display).toContain('Format=app bundle with Mach-O thin (arm64)')
      expect(display).toContain('flags=0x20002(adhoc,linker-signed)')
      expect(display).toContain('Signature=adhoc')
      expect(display).toContain('TeamIdentifier=not set')
      expect(display).toContain('Sealed Resources=none')
      expect(display).not.toMatch(/^Authority=/m)
      await expect(
        capture(context, '/usr/bin/codesign', ['--verify', '--strict', binary])
      ).rejects.toThrow('code has no resources but signature indicates they must be present')
      await expect(
        verifyIOSExecutableSignature(context, binary, 'iphonesimulator')
      ).resolves.toEqual(expectedLinkerSignature)
      expect(readFileSync(binary)).toEqual(original)
      expect(
        JSON.parse(
          readFileSync(join(directory, 'ios-signature-iphonesimulator-verification.json'), 'utf8')
        )
      ).toEqual({
        scope: 'standalone-mach-o',
        binarySha256: sha256(original),
        verified: true
      })
      expect(existsSync(join(directory, 'simulator.app/_CodeSignature'))).toBe(false)
      expect(existsSync(join(directory, 'simulator.app/embedded.mobileprovision'))).toBe(false)
    }, 60_000)

    it('rejects a real changed signed page while preserving Mach-O structure and its signature', async () => {
      const app = join(directory, 'tampered.app')
      mkdirSync(app)
      copyFileSync(join(directory, 'simulator.app/Info.plist'), join(app, 'Info.plist'))
      const original = readFileSync(binaries.simulator)
      const changed = Buffer.from(original)
      expect(changed.readUInt32LE(0)).toBe(0xfeedfacf)
      const markerOffset = changed.indexOf(marker)
      expect(markerOffset).toBeGreaterThan(32 + changed.readUInt32LE(20))
      expect(changed.indexOf(marker, markerOffset + 1)).toBe(-1)
      let signatureOffset
      for (let command = 0, offset = 32; command < changed.readUInt32LE(16); command++) {
        if (changed.readUInt32LE(offset) === 0x1d) {
          signatureOffset = changed.readUInt32LE(offset + 8)
        }
        offset += changed.readUInt32LE(offset + 4)
      }
      expect(signatureOffset).toBeGreaterThan(markerOffset + marker.length)
      changed[markerOffset] ^= 1
      expect(changed.subarray(0, 32 + changed.readUInt32LE(20))).toEqual(
        original.subarray(0, 32 + original.readUInt32LE(20))
      )
      expect(changed.subarray(signatureOffset)).toEqual(original.subarray(signatureOffset))
      const binary = join(app, 'Probe')
      writeFileSync(binary, changed, { mode: 0o755 })
      const tamperContext = { ...context, logs: join(directory, 'tamper-verification') }
      await expect(
        verifyIOSExecutableSignature(tamperContext, binary, 'iphonesimulator')
      ).rejects.toThrow(/invalid signature|code or signature have been modified/)
      expect(readFileSync(binary)).toEqual(changed)
      expect(
        JSON.parse(
          readFileSync(
            join(tamperContext.logs, 'ios-signature-iphonesimulator-verification.json'),
            'utf8'
          )
        ).verified
      ).toBe(false)
    }, 60_000)

    it('accepts the truly unsigned arm64 device executable without generating a signature', async () => {
      const original = readFileSync(binaries.device)
      await expect(
        capture(context, '/usr/bin/codesign', ['--display', '--verbose=4', binaries.device])
      ).rejects.toThrow('code object is not signed at all')
      await expect(
        verifyIOSExecutableSignature(context, binaries.device, 'iphoneos')
      ).resolves.toEqual({ status: 'unsigned' })
      expect(readFileSync(binaries.device)).toEqual(original)
    }, 60_000)

    it('rejects an actual linker signature under the unsigned device archive contract', async () => {
      const original = readFileSync(binaries.simulator)
      await expect(
        verifyIOSExecutableSignature(context, binaries.simulator, 'iphoneos')
      ).rejects.toThrow('unsigned device archive was required')
      expect(readFileSync(binaries.simulator)).toEqual(original)
    }, 60_000)
  }
)
