import { lstatSync, readdirSync, realpathSync, unlinkSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDirectInvocation } from './script-entry-detection.mjs'

const sourceExtensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs']
const emitSuffix = /(?:\.d\.(?:ts|mts|cts)|\.(?:js|mjs|cjs))(?:\.map)?$/

function statIfPresent(file) {
  try {
    return lstatSync(file)
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

function ownedRelative(root, file) {
  const name = relative(root, file)
  if (!name || name === '..' || name.startsWith(`..${sep}`) || isAbsolute(name)) {
    throw new Error(`CLI emit path is outside its owned scope: ${file}`)
  }
  return name
}

function assertUnlinkedPath(root, file) {
  const parts = ownedRelative(root, file).split(sep)
  let current = root
  for (const part of parts) {
    current = join(current, part)
    if (statIfPresent(current)?.isSymbolicLink()) {
      throw new Error(`CLI emit scope contains a linked path: ${current}`)
    }
  }
}

function hasSource(root, sourceStem) {
  return sourceExtensions.some((extension) => {
    const candidate = sourceStem + extension
    assertUnlinkedPath(root, candidate)
    return statIfPresent(candidate)?.isFile() === true
  })
}

/** Only plain tsc-owned CLI/shared emits; bundled main/renderer and assets are untouched. */
export function pruneStaleCliEmits(projectRoot) {
  const requestedRoot = resolve(projectRoot)
  if (lstatSync(requestedRoot).isSymbolicLink()) {
    throw new Error('CLI project root must not be linked')
  }
  const root = realpathSync(requestedRoot)
  const scopes = ['cli', 'shared'].map((name) => ({
    source: join(root, 'src', name),
    output: join(root, 'out', name)
  }))
  // Validate both scopes before removing anything, including a missing output tree's ancestors.
  for (const scope of scopes) {
    assertUnlinkedPath(root, scope.source)
    assertUnlinkedPath(root, scope.output)
    if (!statIfPresent(scope.source)?.isDirectory()) {
      throw new Error(`Missing CLI source scope: ${scope.source}`)
    }
    const output = statIfPresent(scope.output)
    if (output && !output.isDirectory()) {
      throw new Error(`Invalid CLI output scope: ${scope.output}`)
    }
  }
  const stale = []
  for (const scope of scopes) {
    function visit(directory) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = join(directory, entry.name)
        if (entry.isSymbolicLink()) {
          continue
        }
        if (entry.isDirectory()) {
          visit(file)
        } else if (entry.isFile() && emitSuffix.test(entry.name)) {
          const stem = ownedRelative(scope.output, file).replace(emitSuffix, '')
          const sourceStem = join(scope.source, stem)
          if (!hasSource(root, sourceStem)) {
            stale.push({ file, sourceStem })
          }
        }
      }
    }
    if (statIfPresent(scope.output)) {
      visit(scope.output)
    }
  }
  const removed = []
  for (const { file, sourceStem } of stale) {
    assertUnlinkedPath(root, file)
    if (statIfPresent(file)?.isFile() && !hasSource(root, sourceStem)) {
      unlinkSync(file)
      removed.push(ownedRelative(root, file).split(sep).join('/'))
    }
  }
  return { removed }
}

if (isDirectInvocation(import.meta.url, process.argv[1])) {
  const root = realpathSync(fileURLToPath(new URL('../..', import.meta.url)))
  if (realpathSync(process.cwd()) !== root) {
    throw new Error('Run CLI emit cleanup from the repository root')
  }
  const result = pruneStaleCliEmits(root)
  console.log(`Removed ${result.removed.length} stale CLI/shared emit files.`)
}
