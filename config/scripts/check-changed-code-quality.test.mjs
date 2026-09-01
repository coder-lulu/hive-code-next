import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  chunkFilesForCommand,
  parseAddedLineRangesByFile,
  resolveOxlintCommand,
  isMovedCode
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
