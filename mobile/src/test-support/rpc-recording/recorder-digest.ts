import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, posix } from 'node:path'
import { RECORDING_DRIVERS } from './recording-drivers'

export const RECORDER_DIRECTORY = 'mobile/src/test-support/rpc-recording'
/** The mount adapters are attributed per operation in the external Hive manifest. */
export const ADAPTER_DIRECTORY = `${RECORDER_DIRECTORY}/adapters`
/**
 * Mutant evidence. Excluded below and pinned by nothing: no recording ever reads it. Deliberately
 * not exported — an importable handle is a way for the recording path to name the directory without
 * spelling it, and `mutants/mutant-seam.test.ts` rejects both spellings.
 */
const MUTANT_DIRECTORY = `${RECORDER_DIRECTORY}/mutants`
const digests = new Map<string, string>()

function skippedTest(name: string): boolean {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: membership test on a readonly literal tuple, not a cast of the value.
  return name.endsWith('.test.ts') && !(RECORDING_DRIVERS as readonly string[]).includes(name)
}

function collect(root: string, relative: string, files: string[]): void {
  for (const entry of readdirSync(join(root, relative), { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : 1
  )) {
    const child = `${relative}/${entry.name}`
    if (entry.isDirectory()) {
      if (child !== ADAPTER_DIRECTORY && child !== MUTANT_DIRECTORY) {
        collect(root, child, files)
      }
    } else if (!entry.name.endsWith('.md') && !skippedTest(entry.name)) {
      files.push(child)
    }
  }
}

/**
 * Executable recorder inputs shared across domains, stored in external Hive provenance.
 * Prose, non-recording tests and planted mutants cannot produce an observation, so they are
 * excluded. Scenarios and domain adapters have separate digests in that same manifest.
 */
export function recorderSha256(root: string): string {
  const cached = digests.get(root)
  if (cached !== undefined) {
    return cached
  }
  const files: string[] = []
  collect(root, RECORDER_DIRECTORY, files)
  const digest = createHash('sha256')
    .update(
      files
        .map(
          (file) =>
            `${file}:${readFileSync(join(root, ...file.split(posix.sep)), 'utf8').replace(/\r\n/g, '\n')}`
        )
        .join('\n')
    )
    .digest('hex')
  digests.set(root, digest)
  return digest
}
