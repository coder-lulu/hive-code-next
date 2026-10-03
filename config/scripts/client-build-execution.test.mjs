import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { acquireBuildLock } from './client-build-execution.mjs'
import { deliverArtifacts } from './client-build-artifacts.mjs'
import { installedResourceFingerprint, sha256 } from './client-build-contract.mjs'
import { copyWritableElectronRuntime } from './client-build-desktop.mjs'

describe('client build ownership and publication', () => {
  it('can package twice from read-only runtime files without modifying the source', () => {
    const root = mkdtempSync(join(tmpdir(), 'hive-client-runtime-'))
    try {
      const source = join(root, 'source')
      const destination = join(root, 'staging')
      mkdirSync(source)
      writeFileSync(join(source, 'electron.exe'), 'original-runtime')
      chmodSync(join(source, 'electron.exe'), 0o444)
      copyWritableElectronRuntime(source, destination)
      writeFileSync(join(destination, 'electron.exe'), 'packager-edit')
      copyWritableElectronRuntime(source, destination)
      expect(readFileSync(join(source, 'electron.exe'), 'utf8')).toBe('original-runtime')
      expect(readFileSync(join(destination, 'electron.exe'), 'utf8')).toBe('original-runtime')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
  it('invalidates preparation when installed metadata changes or disappears', () => {
    const root = mkdtempSync(join(tmpdir(), 'hive-client-resources-'))
    try {
      const files = [
        'node_modules/.modules.yaml',
        'node_modules/electron/package.json',
        'node_modules/electron/dist/version',
        'node_modules/electron-builder/package.json'
      ]
      for (const file of files) {
        mkdirSync(dirname(join(root, file)), { recursive: true })
        writeFileSync(join(root, file), 'original')
      }
      const original = installedResourceFingerprint({ root }, 'windows-x64')
      writeFileSync(join(root, files[2]), 'different-runtime')
      expect(installedResourceFingerprint({ root }, 'windows-x64')).not.toBe(original)
      rmSync(join(root, files[2]))
      expect(() => installedResourceFingerprint({ root }, 'windows-x64')).toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
  it('refuses competing operations and does not release a changed owner', () => {
    const root = mkdtempSync(join(tmpdir(), 'hive-client-lock-'))
    try {
      const release = acquireBuildLock(root)
      expect(() => acquireBuildLock(root)).toThrow('Another client build')
      writeFileSync(join(root, '.client-build.lock'), 'different-owner')
      release()
      expect(readFileSync(join(root, '.client-build.lock'), 'utf8')).toBe('different-owner')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
  it('publishes checksums and isolates targets and attempts', () => {
    const root = mkdtempSync(join(tmpdir(), 'hive-client-artifacts-'))
    try {
      const source = join(root, 'input.apk')
      writeFileSync(source, 'verified-input')
      const context = {
        output: join(root, 'dist'),
        attempt: 'one',
        pkg: { version: '1.0.0' },
        release: { desktopBuildNumber: 1 },
        app: { expo: { android: { versionCode: 1 } } },
        source: { commit: 'test' },
        toolchain: {},
        logs: join(root, 'logs')
      }
      const verified = { files: [{ source, name: 'app.apk' }], signature: { status: 'verified' } }
      const first = deliverArtifacts(context, 'android', verified, 'deps')
      context.attempt = 'two'
      const second = deliverArtifacts(context, 'android', verified, 'deps')
      expect(first).not.toBe(second)
      expect(readFileSync(join(first, 'app.apk'), 'utf8')).toBe('verified-input')
      expect(readFileSync(join(second, 'SHA256SUMS.txt'), 'utf8')).toContain(
        sha256('verified-input')
      )
      expect(
        JSON.parse(readFileSync(join(context.output, 'android/latest.json'), 'utf8')).directory
      ).toBe('two')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
