import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RECORDING_DRIVERS } from '../recording-drivers'

const root = resolve(import.meta.dirname, '../../../../..')
const recorder = join(root, 'mobile/src/test-support/rpc-recording')
const mutants = join(recorder, 'mutants')
const recordScript = join(root, 'mobile/scripts/rpc-recording.mts')
/** This module names the directory only to exclude it from the recorder digest. */
const MUTANT_EXCLUDER = 'recorder-digest.ts'
const MUTANT_NAMES = ['mutants', 'MUTANT_DIRECTORY']

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name))
}

const resolutions = new Map<string, string | undefined>()
function resolved(from: string, specifier: string): string | undefined {
  const base = resolve(dirname(from), specifier)
  if (resolutions.has(base)) {
    return resolutions.get(base)
  }
  const target = ['', '.ts', '.tsx', '.mts', '.mjs', '/index.ts']
    .map((suffix) => base + suffix)
    .find((candidate) => /\.(?:tsx?|mts|mjs)$/.test(candidate) && existsSync(candidate))
  resolutions.set(base, target)
  return target
}

function relative(file: string): string {
  return file.slice(recorder.length + 1)
}

/** A suite that records nothing: excluded below, since no driver has reason to reach it. */
function suite(file: string): boolean {
  return file.endsWith('.test.ts') && !RECORDING_DRIVERS.some((driver) => file.endsWith(driver))
}

// The entry graphs remain independent; the immutable import topology is read once per module.
const imports = new Map<string, readonly string[]>()
function importedFiles(file: string): readonly string[] {
  const cached = imports.get(file)
  if (cached) {
    return cached
  }
  const targets = [
    ...readFileSync(file, 'utf8').matchAll(/(?:from|import\()\s*'(\.[^']*)'/g)
  ].flatMap((match) => {
    const target = resolved(file, match[1]!)
    return target ? [target] : []
  })
  imports.set(file, targets)
  return targets
}

/**
 * Every module a driver pulls in, transitively, by static import or dynamic `import()`. Type
 * positions come along, which is why the graph is an order larger than the recorder itself: a
 * `typeof import(...)` drags in product modules. Reaching too much only widens what may not appear.
 */
function reachable(entries: readonly string[]): Set<string> {
  const seen = new Set<string>()
  const pending = [...entries]
  while (pending.length > 0) {
    const file = pending.pop()!
    if (seen.has(file)) {
      continue
    }
    seen.add(file)
    pending.push(...importedFiles(file))
  }
  return seen
}

/**
 * A mutant planted on the recording path would be recorded and replayed alike, so every golden
 * would compare clean while certifying the mutated code rather than the product. Reachability is
 * proved from the recording drivers outward rather than from this directory inward, because the
 * question is what a golden's bytes can depend on. The name scan then covers the paths a module can
 * be read by rather than imported.
 */
describe('the mutant seam', () => {
  const outside = sources(recorder).filter((file) => !file.startsWith(`${mutants}${sep}`))

  it('is unreachable from recording drivers and the actual Hive record script', () => {
    const graphs = [
      reachable(RECORDING_DRIVERS.map((driver) => join(recorder, driver))),
      reachable([recordScript])
    ]
    for (const graph of graphs) {
      const reached = [...graph]
        .filter((file) => file.startsWith(`${mutants}${sep}`))
        .map(relative)
        .sort()
      expect(reached).toEqual([])
    }
    // The drivers emit observations; the script also computes external Hive provenance. Every
    // executable recorder module must belong to at least one actual entry graph.
    const owned = new Set(graphs.flatMap((graph) => [...graph]))
    const missed = outside
      .filter((file) => !suite(file) && !owned.has(file))
      .map(relative)
      .sort()
    expect(missed).toEqual([])
    expect(sources(mutants).length).toBeGreaterThan(1)
  })

  // The digest's unique directory exclusion is not a product dependency. All other modules and
  // the actual record script must reject both the directory spelling and an imported alias.
  it('is named only by the module that excludes it from the provenance digest', () => {
    const naming = [...outside, recordScript]
      .filter((file) => !suite(file) && relative(file) !== MUTANT_EXCLUDER)
      .filter((file) => {
        const content = readFileSync(file, 'utf8')
        return MUTANT_NAMES.some((name) => content.includes(name))
      })
      .map((file) => (file === recordScript ? 'mobile/scripts/rpc-recording.mts' : relative(file)))
    expect(naming).toEqual([])
  })
})
