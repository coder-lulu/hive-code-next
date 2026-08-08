import { describe, expect, it } from 'vitest'

import {
  normalizeRepoPath,
  scanBrandBoundary,
  validateAllowlist
} from './check-hivecode-brand-boundary.mjs'

function scan(contents, allowedFiles = [], protectedFileHashes = {}) {
  const effectiveHashes =
    Object.keys(protectedFileHashes).length > 0
      ? protectedFileHashes
      : {
          '.gitignore': '0000000000000000000000000000000000000000000000000000000000000000',
          '.gitattributes': '0000000000000000000000000000000000000000000000000000000000000000'
        }
  const files = Object.keys(contents)
  return scanBrandBoundary({
    files,
    allowlist: {
      schemaVersion: 2,
      literal: 'hivecode',
      allowedFiles: [...allowedFiles].sort((left, right) => left.localeCompare(right, 'en')),
      protectedFileHashes: effectiveHashes
    },
    readText: (filePath) => contents[filePath]
  })
}

const ALLOWLIST_STUB = {
  schemaVersion: 2,
  literal: 'hivecode',
  allowedFiles: [],
  protectedFileHashes: {
    '.gitignore': '0000000000000000000000000000000000000000000000000000000000000000',
    '.gitattributes': '0000000000000000000000000000000000000000000000000000000000000000'
  }
}

describe('normalizeRepoPath', () => {
  it('normalizes Windows and dot-prefixed repository paths', () => {
    expect(normalizeRepoPath('.\\src\\main\\product.ts')).toBe('src/main/product.ts')
    expect(normalizeRepoPath('./src/main/product.ts')).toBe('src/main/product.ts')
  })
})

describe('validateAllowlist', () => {
  it('requires schema v2 to protect .gitignore with a normalized hash', () => {
    expect(() =>
      validateAllowlist({
        schemaVersion: 2,
        literal: 'hivecode',
        allowedFiles: [],
        protectedFileHashes: {}
      })
    ).toThrow('.gitignore must be protected')
  })

  it('rejects duplicate, unsorted, and escaping entries', () => {
    expect(() =>
      validateAllowlist({
        ...ALLOWLIST_STUB,
        allowedFiles: ['b.ts', 'a.ts']
      })
    ).toThrow('must be sorted')
    expect(() =>
      validateAllowlist({
        ...ALLOWLIST_STUB,
        allowedFiles: ['a.ts', 'a.ts']
      })
    ).toThrow('duplicate path')
    expect(() =>
      validateAllowlist({
        ...ALLOWLIST_STUB,
        allowedFiles: ['../outside.ts']
      })
    ).toThrow('unsafe repository path')
  })

  it('rejects wrong brand literal', () => {
    expect(() =>
      validateAllowlist({
        ...ALLOWLIST_STUB,
        literal: 'not-hivecode'
      })
    ).toThrow("Brand allowlist literal must be 'hivecode'")
  })
})

describe('scanBrandBoundary', () => {
  it('reports a protected gitignore whose normalized content hash changed', () => {
    const result = scanBrandBoundary({
      files: ['.gitignore', 'src/plain.ts'],
      allowlist: {
        schemaVersion: 2,
        literal: 'hivecode',
        allowedFiles: [],
        protectedFileHashes: {
          '.gitignore': '0000000000000000000000000000000000000000000000000000000000000000',
          '.gitattributes': '0000000000000000000000000000000000000000000000000000000000000000'
        }
      },
      readText: (filePath) =>
        filePath === '.gitignore' ? 'src/hidden-brand-file.ts\n' : 'export const name = "orca"\n'
    })

    expect(result.changedProtectedFiles).toEqual(['.gitignore', '.gitattributes'])
  })

  it('finds case-insensitive content and path literals outside the allowlist', () => {
    const result = scan({
      'src/internal.ts': 'const product = "HiveCode"\n',
      'src/HiveCode-internal.ts': 'const product = "orca"\n',
      'src/plain.ts': 'const product = "orca"\n'
    })

    expect(result.violations).toEqual([
      { path: 'src/internal.ts', pathMatches: false, lineNumbers: [1] },
      { path: 'src/HiveCode-internal.ts', pathMatches: true, lineNumbers: [] }
    ])
    expect(result.staleAllowedFiles).toEqual([])
  })

  it('accepts reviewed files and reports stale entries for ratcheting', () => {
    const result = scan(
      {
        'config/product.ts': 'export const name = "hivecode"\n',
        'src/plain.ts': 'export const name = "orca"\n'
      },
      ['config/product.ts', 'src/plain.ts']
    )

    expect(result.violations).toEqual([])
    expect(result.literalFiles).toHaveLength(1)
    expect(result.staleAllowedFiles).toEqual(['src/plain.ts'])
  })

  it('skips binary files instead of decoding arbitrary bytes as source', () => {
    const result = scan({ 'assets/logo.bin': '\0hivecode\0' })

    expect(result.literalFiles).toEqual([])
    expect(result.violations).toEqual([])
  })
})
