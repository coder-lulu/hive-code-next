import path from 'node:path'
import { describe, expect, it, test } from 'vitest'
import {
  chunkFilesForCommand,
  parseAddedLineRangesByFile,
  resolveOxlintCommand,
  OXLINT_SCANS,
  diagnosticTouchesAddedLines,
  isMovedCode,
  isRootCodeQualityPath,
  overlapsAddedLines,
  parseAddedLineRanges
} from './check-changed-code-quality.mjs'

describe('changed-code quality diff parsing', () => {
  test('collects added-line ranges for every file from one combined diff', () => {
    const diff = `diff --git a/src/first.ts b/src/first.ts
index 1111111..2222222 100644
--- a/src/first.ts
+++ b/src/first.ts
@@ -2,0 +3,2 @@
+const first = true
+const second = true
diff --git a/src/nested/second.tsx b/src/nested/second.tsx
index 3333333..4444444 100644
--- a/src/nested/second.tsx
+++ b/src/nested/second.tsx
@@ -8,2 +8,0 @@
-old
-lines
@@ -12 +10,3 @@
-old value
+new value
+new value 2
+new value 3
`

    expect(parseAddedLineRangesByFile(diff)).toEqual(
      new Map([
        ['src/first.ts', [{ start: 3, end: 4 }]],
        ['src/nested/second.tsx', [{ start: 10, end: 12 }]]
      ])
    )
  })

  test('ignores deleted files and normalizes quoted UTF-8 paths', () => {
    const diff = `diff --git a/src/deleted.ts b/src/deleted.ts
index 1111111..0000000 100644
--- a/src/deleted.ts
+++ /dev/null
@@ -1 +0,0 @@
-old
diff --git "a/src/\\344\\270\\255\\346\\226\\207.ts" "b/src/\\344\\270\\255\\346\\226\\207.ts"
index 1111111..2222222 100644
--- "a/src/\\344\\270\\255\\346\\226\\207.ts"
+++ "b/src/\\344\\270\\255\\346\\226\\207.ts"
@@ -1 +1 @@
-old
+new
`

    expect(parseAddedLineRangesByFile(diff)).toEqual(
      new Map([['src/中文.ts', [{ start: 1, end: 1 }]]])
    )
  })
})

describe('changed-code quality command batching', () => {
  test('keeps every file in order while bounding command argument length', () => {
    const files = ['src/first-file.ts', 'src/second-file.ts', 'src/third-file.ts']

    expect(chunkFilesForCommand(files, 37)).toEqual([
      ['src/first-file.ts', 'src/second-file.ts'],
      ['src/third-file.ts']
    ])
  })

  test('runs the repository-local Oxlint launcher with the active Node executable', () => {
    expect(resolveOxlintCommand('C:/repo', 'C:/node/node.exe')).toEqual({
      command: 'C:/node/node.exe',
      args: [path.join('C:/repo', 'node_modules', 'oxlint', 'bin', 'oxlint')]
    })
  })
})

describe('moved-code exemption', () => {
  test('treats a verbatim contiguous block from the base as moved', () => {
    const base = [['const a = 1', 'items.map((item, index) => (', 'key={index}', '))']]
    expect(isMovedCode(['items.map((item, index) => (', 'key={index}', '))'], base)).toBe(true)
  })

  test('ignores indentation and whitespace changes from the move', () => {
    const base = [['    items.map((item, index) => (', '      key={index}']]
    expect(isMovedCode(['items.map((item, index) => (', 'key={index}'], base)).toBe(true)
  })

  test('does not exempt a genuinely new violation', () => {
    const base = [['const a = 1', 'const b = 2']]
    expect(isMovedCode(['rows.map((row, i) => <td key={i} />)'], base)).toBe(false)
  })

  test('does not exempt a block that is only partly present in the base', () => {
    const base = [['doThing()', 'unrelated()']]
    expect(isMovedCode(['doThing()', 'newlyAddedSideEffect()'], base)).toBe(false)
  })

  test('tolerates a few lines appended inside the moved block', () => {
    // A split commonly grows a hook dependency array when closure variables
    // become props; the moved body around it is still moved.
    const body = Array.from({ length: 20 }, (_, i) => `line${i}()`)
    const base = [body]
    const moved = [...body.slice(0, 19), 'newDep,', body[19]]
    expect(isMovedCode(moved, base)).toBe(true)
  })

  test('does not exempt when the anchor line is absent from the base', () => {
    const base = [['doThing()', 'filler()', 'other()']]
    expect(isMovedCode(['brandNewCall()', 'doThing()', 'other()'], base)).toBe(false)
  })

  test('does not exempt when most of the block is absent from the base', () => {
    const base = [['keep0()', 'keep1()', 'unrelated()']]
    const mostlyNew = ['keep0()', ...Array.from({ length: 18 }, (_, i) => `fresh${i}()`)]
    expect(isMovedCode(mostlyNew, base)).toBe(false)
  })

  test('ignores blank lines when matching', () => {
    const base = [['a()', 'b()']]
    expect(isMovedCode(['a()', '', 'b()'], base)).toBe(true)
  })

  test('never exempts an empty highlight', () => {
    expect(isMovedCode(['', '   '], [['a()']])).toBe(false)
  })
})

describe('changed-code quality line matching', () => {
  it('parses added and replaced hunk ranges while ignoring deletions', () => {
    const ranges = parseAddedLineRanges(
      ['@@ -10,2 +10,3 @@', '@@ -20 +21 @@', '@@ -40,4 +42,0 @@', '@@ -50 +48,2 @@'].join('\n')
    )

    expect(ranges).toEqual([
      { start: 10, end: 12 },
      { start: 21, end: 21 },
      { start: 48, end: 49 }
    ])
  })

  it('matches diagnostics that overlap any added line', () => {
    const ranges = [
      { start: 5, end: 7 },
      { start: 12, end: 12 }
    ]

    expect(overlapsAddedLines(3, 5, ranges)).toBe(true)
    expect(overlapsAddedLines(8, 11, ranges)).toBe(false)
    expect(overlapsAddedLines(12, 14, ranges)).toBe(true)
  })

  it('normalizes absolute diagnostic paths before matching', () => {
    const root = process.cwd()
    const file = 'config/scripts/check-changed-code-quality.test.mjs'
    const diagnostic = {
      filename: `${root}/${file}`,
      labels: [{ span: { line: 24 } }]
    }

    expect(
      diagnosticTouchesAddedLines(diagnostic, new Map([[file, [{ start: 24, end: 24 }]]]), root)
    ).toBe(true)
  })

  // Why: pinning --config disables nested-config discovery, so root rules that
  // mobile/.oxlintrc.json turns off would fail the gate on mobile files.
  it('lets the untyped scan discover nested configs instead of pinning the root config', () => {
    const scan = OXLINT_SCANS.find((candidate) => candidate.label === 'code quality')

    expect(scan.args).not.toContain('--config')
    expect(scan.args).not.toContain('--disable-nested-config')
  })

  it('leaves Cloud source to the independent Cloud quality checks', () => {
    expect(isRootCodeQualityPath('cloud/apps/relay/src/index.ts')).toBe(false)
    expect(isRootCodeQualityPath('src/main/index.ts')).toBe(true)
  })
})
