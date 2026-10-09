import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseCspDirectives, projectDir, readShellCsp } from './mobile-web-app-render-harness.mjs'

let cspHeader

beforeAll(async () => {
  cspHeader = await readShellCsp()
})

describe('the shell policy this page is tested under', () => {
  it('is the same on both platforms, so one render check covers both', async () => {
    const swift = await readFile(
      join(projectDir, 'mobile/modules/orca-mobile-web-shell/ios/MobileWebShellCsp.swift'),
      'utf8'
    )
    expect(parseCspDirectives(swift, 'static let header = [', '].joined')).toBe(cspHeader)
  })

  it('reads directives from the source and not from the comments around them', () => {
    const source = [
      'static let header = [',
      "  // React Native Web needs \"style-src 'self' 'unsafe-inline'\" and nothing more.",
      '  "default-src \'none\'",',
      '  "script-src \'self\'",',
      "  \"style-src 'self' 'unsafe-inline'\",",
      '  "img-src \'self\'",',
      '  "connect-src \'self\'",',
      '  "worker-src \'none\'",',
      '  "frame-src \'none\'",',
      '  "child-src \'none\'",',
      '  "object-src \'none\'",',
      '  "base-uri \'none\'",',
      '  "form-action \'none\'",',
      '  "frame-ancestors \'none\'"',
      '].joined'
    ].join('\n')
    const parsed = parseCspDirectives(source, 'static let header = [', '].joined')
    expect(parsed.split('; ')[0]).toBe("default-src 'none'")
    expect(parsed.split('; ').filter((entry) => entry.includes('unsafe-inline'))).toEqual([
      "style-src 'self' 'unsafe-inline'"
    ])
  })

  it('still refuses inline script, which is the directive that matters', () => {
    expect(cspHeader).toContain("script-src 'self';")
    expect(cspHeader).not.toContain("script-src 'self' 'unsafe-inline'")
  })

  it('admits data: and https: for images and for nothing else', () => {
    expect(cspHeader.split('; ').filter((entry) => entry.includes('data:'))).toEqual([
      "img-src 'self' data: https:"
    ])
    expect(cspHeader.split('; ').filter((entry) => entry.includes('https:'))).toEqual([
      "img-src 'self' data: https:"
    ])
    // `http:` is not a substring of `https:`, so this still refuses a cleartext source.
    expect(cspHeader).not.toContain('http:')
  })
})

describe('Swift source directive parser', () => {
  it('reads directives from the source and not from the comments around them', () => {
    const source = [
      'static let header = [',
      "  // React Native Web needs \"style-src 'self' 'unsafe-inline'\" and nothing more.",
      '  "default-src \'none\'",',
      '  "script-src \'self\'",',
      "  \"style-src 'self' 'unsafe-inline'\",",
      '  "img-src \'self\'",',
      '  "connect-src \'self\'",',
      '  "worker-src \'none\'",',
      '  "frame-src \'none\'",',
      '  "child-src \'none\'",',
      '  "object-src \'none\'",',
      '  "base-uri \'none\'",',
      '  "form-action \'none\'",',
      '  "frame-ancestors \'none\'"',
      '].joined'
    ].join('\n')
    const parsed = parseCspDirectives(source, 'static let header = [', '].joined')
    expect(parsed.split('; ')[0]).toBe("default-src 'none'")
    expect(parsed.split('; ').filter((entry) => entry.includes('unsafe-inline'))).toEqual([
      "style-src 'self' 'unsafe-inline'"
    ])
  })
})
