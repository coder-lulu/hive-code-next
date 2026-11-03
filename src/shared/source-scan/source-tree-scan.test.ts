import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { blankStringContents, scanSourceTree, stripComments } from './source-tree-scan'

const filesystem = vi.hoisted(() => ({
  readdirSync:
    vi.fn<
      (
        path: string
      ) => { name: string; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }[]
    >(),
  statSync: vi.fn<(path: string) => { isDirectory(): boolean }>(),
  readFileSync: vi.fn<(path: string) => string>()
}))
vi.mock('node:fs', () => filesystem)

describe('scanSourceTree', () => {
  it('skips root artifact logs before stat while retaining source and nested logs', () => {
    const root = join(process.cwd(), 'logs', 'scanner-fixture')
    const artifacts = join(root, 'logs')
    const source = join(root, 'src')
    const nestedLogs = join(source, 'logs')
    const directories = new Map([
      [root, ['logs', 'src']],
      [source, ['live.test.ts', 'logs']],
      [nestedLogs, ['retained.ts']]
    ])
    const files = new Map([
      [join(source, 'live.test.ts'), 'describe("live", () => {})'],
      [join(nestedLogs, 'retained.ts'), 'export const retained = true']
    ])
    filesystem.readdirSync.mockImplementation((path) =>
      (directories.get(path) ?? []).map((name) => ({
        name,
        isDirectory: () => directories.has(join(path, name)),
        isFile: () => !directories.has(join(path, name)),
        isSymbolicLink: () => false
      }))
    )
    filesystem.statSync.mockImplementation((path) => {
      if (path === artifacts) {
        throw new Error('Artifact entry disappeared during cleanup')
      }
      return { isDirectory: () => directories.has(path) }
    })
    filesystem.readFileSync.mockImplementation((path) => {
      const content = files.get(path)
      if (content === undefined) {
        throw new Error(`Unexpected source read: ${path}`)
      }
      return content
    })
    try {
      expect(
        scanSourceTree(root, { includeTests: true, excludeRootDirectories: ['logs'] })
      ).toEqual(
        [...files].map(([path, content], index) => ({
          path,
          relativePath: ['src/live.test.ts', 'src/logs/retained.ts'][index],
          source: content
        }))
      )
      expect(filesystem.statSync).not.toHaveBeenCalledWith(artifacts)
      expect(filesystem.readdirSync).not.toHaveBeenCalledWith(artifacts)
    } finally {
      vi.resetAllMocks()
    }
  })

  it('retains legitimate logs beneath a source root by default', () => {
    const root = join(process.cwd(), 'logs', 'source-root-fixture')
    const logs = join(root, 'logs')
    const path = join(logs, 'implementation.ts')
    const content = 'export const sourceLog = true'
    filesystem.readdirSync.mockImplementation((directory) =>
      (directory === root ? ['logs'] : ['implementation.ts']).map((name) => ({
        name,
        isDirectory: () => join(directory, name) === logs,
        isFile: () => join(directory, name) !== logs,
        isSymbolicLink: () => false
      }))
    )
    filesystem.statSync.mockImplementation((entry) => ({ isDirectory: () => entry === logs }))
    filesystem.readFileSync.mockReturnValue(content)
    try {
      expect(scanSourceTree(root)).toEqual([
        { path, relativePath: 'logs/implementation.ts', source: content }
      ])
      expect(filesystem.statSync).not.toHaveBeenCalled()
      expect(filesystem.readdirSync).toHaveBeenCalledWith(logs, { withFileTypes: true })
    } finally {
      vi.resetAllMocks()
    }
  })
})

/** A glob’s slash-star once hid 24,000 live-code characters and an unguarded spawn; guards must never under-report. */
describe('stripComments', () => {
  it('leaves a POSIX glob in a template literal alone', () => {
    const source = ['const s = `', '  case "$root"/*/home) echo hit;; esac', '`', 'spawn(x)'].join(
      '\n'
    )
    expect(stripComments(source)).toContain('case "$root"/*/home)')
    expect(stripComments(source)).toContain('spawn(x)')
  })

  it('is not derailed by an apostrophe in prose', () => {
    // A prose apostrophe once swallowed the rest of the file and disabled later comment stripping.
    const source = ["// don't do this", '/* spawn(bad) */', 'spawn(good)'].join('\n')
    expect(stripComments(source)).not.toContain('bad')
  })

  it('is not derailed by a quote inside a regex literal', () => {
    const source = ['const re = /[\'"]/', '/* spawn(bad) */', 'spawn(good)'].join('\n')
    expect(stripComments(source)).not.toContain('bad')
  })

  it('handles an escaped quote inside a string', () => {
    const source = ["const s = 'it\\'s'", '/* spawn(bad) */'].join('\n')
    expect(stripComments(source)).not.toContain('bad')
  })
})

describe('regex literals', () => {
  it('does not let an apostrophe in a pattern open a string', () => {
    // A regex apostrophe once inverted quote state for the rest of the file and hid real calls.
    const source =
      "const q = (v: string): string => `'${v.replace(/'/g, \"x\")}'`\nspawn('wsl.exe')\n"
    expect(blankStringContents(source, true)).not.toBe('desynced')
    expect(blankStringContents(source)).toContain('spawn(')
  })

  it('treats a leading block comment as a comment, not a pattern', () => {
    // A leading comment once read as a regex and swallowed 110k real-file characters.
    const source = '/* banner with a renderer/Electron slash */\nspawn("wsl.exe")\n'
    // Assert inside the swallowed span; checking only the following spawn misses the regression.
    expect(blankStringContents(source)).toContain('banner with a renderer')
  })

  it.each([
    [
      'postfix decrement',
      "const half = n-- / 2; execFile(bin, args, { cwd: '/usr/bin' })",
      'execFile(bin, args'
    ],
    ['non-null assertion', 'const b = done! / total!\nexecFile(y)\n', 'execFile(y)'],
    [
      'JSX self-close',
      'const a = c ? <A size={14} /> : <B size={14} />\nexecFile(x)\n',
      'execFile(x)'
    ]
  ])('reads %s as division, not a pattern', (_case, source, survives) => {
    // False regex positives swallow live calls without desync, making the guard report a false clean.
    expect(blankStringContents(source)).toContain(survives)
  })
})
