import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const PRODUCT_SOURCE_ROOT = path.join(REPO_ROOT, 'src')
const FORBIDDEN_PRODUCT_REFERENCES = [
  'tests/e2e/hiverelay',
  'config/hiverelay-contract/fixtures',
  'config/hiverelay-contract/registries/test-keys.json'
]

async function productSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await productSourceFiles(absolutePath)))
    } else if (/\.(?:[cm]?[jt]sx?)$/.test(entry.name)) {
      files.push(absolutePath)
    }
  }
  return files
}

describe('HiveRelay P0 testkit product boundary', () => {
  it('has no imports or literal references from product source', async () => {
    const violations: string[] = []
    for (const file of await productSourceFiles(PRODUCT_SOURCE_ROOT)) {
      const source = await readFile(file, 'utf8')
      if (FORBIDDEN_PRODUCT_REFERENCES.some((reference) => source.includes(reference))) {
        violations.push(path.relative(REPO_ROOT, file))
      }
    }
    expect(violations).toEqual([])
  })

  it('keeps testkit and vendored test keys outside the packaged application', async () => {
    const builderConfig = await readFile(
      path.join(REPO_ROOT, 'config', 'electron-builder.config.cjs'),
      'utf8'
    )
    expect(builderConfig).toContain("'!tests{,/**/*}'")
    expect(builderConfig).toContain("'!config{,/**/*}'")
  })
})
