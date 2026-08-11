import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  chunkFilesForCommand,
  parseAddedLineRangesByFile,
  resolveOxlintCommand
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
