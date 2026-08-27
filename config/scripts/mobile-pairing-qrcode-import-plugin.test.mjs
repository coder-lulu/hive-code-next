import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runOxlintPluginOnSource } from './oxlint-plugin-test-runner.mjs'

const pluginPath = path.resolve('config/oxlint-plugins/mobile-pairing-qrcode-import.mjs')

function lintSource(source) {
  return runOxlintPluginOnSource({
    pluginName: 'mobile-pairing',
    pluginPath,
    rules: { 'mobile-pairing/no-eager-qrcode-import': 'error' },
    source,
    extension: 'ts'
  })
}

describe('mobile pairing qrcode import rule', () => {
  it('rejects eager runtime imports', () => {
    const diagnostics = lintSource("import QRCode from 'qrcode'\nvoid QRCode")

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'mobile-pairing(no-eager-qrcode-import)'
    ])
  })

  it('allows type-only and lazy imports', () => {
    expect(lintSource("import type QRCode from 'qrcode'\nlet qr: typeof QRCode")).toEqual([])
    expect(lintSource("const QRCode = await import('qrcode')\nvoid QRCode")).toEqual([])
  })
})
