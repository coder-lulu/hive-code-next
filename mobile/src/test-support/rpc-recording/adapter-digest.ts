import { RECORDING_ADAPTER_OWNERS } from '../../../../config/scripts/upstream-recording-adapters.mjs'
import { adapterInputDigest } from '../../../../config/scripts/upstream-recording-inputs.mjs'
import { readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import { MOUNTED_OPERATION_MODULES } from './adapters/mounted-operation-modules'
import { operationModuleLoader } from './operation-module-loader'
import type { MountedOperationModule } from './mounted-operation-module'
import type { RecordingScenario } from './recording-scenario'

const digests = new Map<string, string>()

/**
 * Which module mounts each operation, read off the same `mounts` calls that build the table a
 * recording runs against. A restated map could agree with itself while naming the wrong source.
 */
export function adapterSourceByOperation(
  root: string,
  registered: readonly MountedOperationModule[] = MOUNTED_OPERATION_MODULES
): Map<string, string> {
  const modules = operationModuleLoader(root)
  const owners = new Map<string, string>()
  for (const module of registered) {
    for (const operation of Object.keys(module.mounts(modules, {}))) {
      if (owners.has(operation)) {
        throw new Error('Duplicate adapter operation: ' + operation)
      }
      owners.set(operation, module.source)
    }
  }
  const actual = [...owners].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const expected = Object.entries(RECORDING_ADAPTER_OWNERS).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  )
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      'Adapter factory operations differ from the complete frozen ownership declaration'
    )
  }
  return new Map(expected)
}

/**
 * The adapter source one golden was recorded through: the module mounting each operation its
 * scenarios drive, deduplicated and ordered by file name.
 *
 * Stored per operation in the external Hive provenance manifest, so a new domain does not change
 * the source attribution of another domain. A golden whose operation no module mounts has no runner,
 * so it throws rather than digesting an empty set.
 */
export function adapterSha256(
  root: string,
  scenarios: readonly RecordingScenario[],
  registered: readonly MountedOperationModule[] = MOUNTED_OPERATION_MODULES
): string {
  const owners = adapterSourceByOperation(root, registered)
  const sources = [
    ...new Set(
      scenarios.map((scenario) => {
        const source = owners.get(scenario.operation)
        if (source === undefined) {
          throw new Error(`No adapter module mounts ${scenario.operation}`)
        }
        return source
      })
    )
  ].sort()
  const key = `${root}\0${sources.join('\0')}`
  const cached = digests.get(key)
  if (cached !== undefined) {
    return cached
  }
  const digest = adapterInputDigest(sources, (file) =>
    readFileSync(join(root, ...file.split(posix.sep)))
  )
  digests.set(key, digest)
  return digest
}
