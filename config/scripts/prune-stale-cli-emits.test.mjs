import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  existsSync
} from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { pruneStaleCliEmits } from './prune-stale-cli-emits.mjs'

function fixture() {
  const evidence = resolve('logs/hiveai-removal/cli-emit-fixtures')
  mkdirSync(evidence, { recursive: true })
  const root = mkdtempSync(join(evidence, 'case-'))
  for (const folder of ['src/cli', 'src/shared', 'out/cli', 'out/shared']) {
    mkdirSync(join(root, folder), { recursive: true })
  }
  return root
}

function put(root, name, content = 'fixture') {
  const file = join(root, name)
  mkdirSync(resolve(file, '..'), { recursive: true })
  writeFileSync(file, content)
  return file
}

describe('CLI emit lifecycle', () => {
  it('removes deleted-source emits while keeping the current executable CLI and unrelated outputs', async () => {
    const root = fixture()
    const source = put(root, 'src/cli/retired.ts')
    const stale = [
      'out/cli/retired.js',
      'out/cli/retired.js.map',
      'out/cli/retired.d.ts',
      'out/cli/retired.d.ts.map',
      'out/shared/retired.mjs',
      'out/shared/retired.cjs.map'
    ]
    for (const file of stale) {
      put(root, file)
    }
    put(root, 'src/cli/index.ts')
    const current = put(root, 'out/cli/index.js', 'exports.answer = 42')
    const assets = ['out/cli/help.txt', 'out/main/retired.js', 'out/renderer/retired.js']
    const metadata = put(root, 'out/cli/package.json', '{"type":"commonjs"}')
    for (const file of assets) {
      put(root, file)
    }
    unlinkSync(source)
    expect(pruneStaleCliEmits(root).removed.sort()).toEqual(stale.sort())
    expect(stale.every((file) => !existsSync(join(root, file)))).toBe(true)
    expect(assets.every((file) => readFileSync(join(root, file), 'utf8') === 'fixture')).toBe(true)
    expect(readFileSync(metadata, 'utf8')).toBe('{"type":"commonjs"}')
    expect((await import(pathToFileURL(current).href)).default.answer).toBe(42)
    expect(pruneStaleCliEmits(root).removed).toEqual([])
  })

  it.each(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs'])(
    'preserves all emit sidecars when a current %s source exists',
    (extension) => {
      const root = fixture()
      put(root, `src/shared/nested/current${extension}`)
      const emits = [
        '.js',
        '.mjs',
        '.cjs',
        '.js.map',
        '.d.ts',
        '.d.ts.map',
        '.d.mts',
        '.d.mts.map',
        '.d.cts',
        '.d.cts.map'
      ]
      for (const extension of emits) {
        put(root, `out/shared/nested/current${extension}`)
      }
      expect(pruneStaleCliEmits(root).removed).toEqual([])
    }
  )

  it('does not traverse a linked output subtree or unlink its external sentinel', () => {
    const root = fixture()
    const external = fixture()
    const sentinel = put(external, 'sentinel.js', 'external sentinel')
    symlinkSync(
      external,
      join(root, 'out/cli/linked'),
      process.platform === 'win32' ? 'junction' : 'dir'
    )
    put(root, 'out/shared/stale.js')
    expect(pruneStaleCliEmits(root).removed).toEqual(['out/shared/stale.js'])
    expect(readFileSync(sentinel, 'utf8')).toBe('external sentinel')
  })

  it('rejects a linked output root before deleting any files', () => {
    const root = fixture()
    const external = fixture()
    const sentinel = put(external, 'sentinel.js', 'external sentinel')
    // Use a fresh root without an output scope so creating the link needs no deletion.
    const linkedRoot = join(root, 'linked-root')
    mkdirSync(join(linkedRoot, 'src/cli'), { recursive: true })
    mkdirSync(join(linkedRoot, 'src/shared'), { recursive: true })
    mkdirSync(join(linkedRoot, 'out/cli'), { recursive: true })
    symlinkSync(
      external,
      join(linkedRoot, 'out/shared'),
      process.platform === 'win32' ? 'junction' : 'dir'
    )
    const stale = put(linkedRoot, 'out/cli/stale.js')
    expect(() => pruneStaleCliEmits(linkedRoot)).toThrow(/linked/i)
    expect(existsSync(stale)).toBe(true)
    expect(readFileSync(sentinel, 'utf8')).toBe('external sentinel')
  })

  it('keeps every release entry on the same cleanup-before-compile path', () => {
    const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(scripts['build:cli']).toMatch(
      /^node config\/scripts\/prune-stale-cli-emits.mjs && node .*tsc /
    )
    expect(scripts['build:cli']).toContain('&& pnpm run prepare:cli-output')
    expect(scripts['build:release:javascript']).toContain('pnpm run build:cli')
  })
})
