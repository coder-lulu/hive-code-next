import { createHash } from 'node:crypto'
import { RECORDING_ADAPTER_OWNERS } from './upstream-recording-adapters.mjs'

const hash = (text) => createHash('sha256').update(text).digest('hex')
export function captureScenarioValue(value) {
  if (value === undefined) {
    return { $rpc: 'undefined' }
  }
  if (value === null) {
    return { $rpc: 'null' }
  }
  if (Array.isArray(value)) {
    return value.map(captureScenarioValue)
  }
  if (typeof value === 'object') {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      throw new Error('Observation requires an explicit projection for non-plain objects')
    }
    const entries = Object.keys(value)
      .sort()
      .map((key) => [key, captureScenarioValue(value[key])])
    return '$rpc' in value ? { $rpc: 'object', entries } : Object.fromEntries(entries)
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return { $rpc: 'number', value: String(value) }
  }
  if (['string', 'number', 'boolean'].includes(typeof value)) {
    return value
  }
  throw new Error(`Unsupported observation: ${typeof value}`)
}
export function canonicalRecordingJson(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalRecordingJson).join(',')}]`
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalRecordingJson(value[key])}`)
    .join(',')}}`
}
export function scenarioInputDigest(scenarios) {
  return hash(canonicalRecordingJson(captureScenarioValue(scenarios)))
}
export function decodeScenarioInput(raw) {
  function decode(value) {
    if (Array.isArray(value)) {
      return value.map(decode)
    }
    if (value && typeof value === 'object') {
      if (Object.keys(value).length === 1 && value.$undefined === true) {
        return undefined
      }
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, decode(entry)]))
    }
    return value
  }
  const input = decode(raw)
  if (!Array.isArray(input?.scenarios) || !input.scenarios.length) {
    throw new Error('Invalid recording manifest')
  }
  const retired = [
    ...('baseline' in input ? ['baseline'] : []),
    ...input.scenarios.flatMap((scenario) =>
      'version' in scenario ? [`${scenario.id}.version`] : []
    )
  ]
  if (retired.length) {
    throw new Error(
      `The recording manifest no longer carries a pin or scenario versions; remove: ${retired.join(', ')}`
    )
  }
  if (new Set(input.scenarios.map((scenario) => scenario.id)).size !== input.scenarios.length) {
    throw new Error('Duplicate scenario ids')
  }
  return input
}

export const RECORDING_DRIVERS = Object.freeze([
  'pilot-recordings.test.ts',
  'family-recordings.test.ts'
])
export function recorderInputDigest(paths, read) {
  const root = 'mobile/src/test-support/rpc-recording'
  const selected = paths.filter(
    (path) =>
      path.startsWith(`${root}/`) &&
      !path.startsWith(`${root}/adapters/`) &&
      !path.startsWith(`${root}/mutants/`)
  )
  // Match directory traversal order, not a global path sort (a.ts sorts before a/b.ts globally).
  const files = []
  function collect(directory) {
    const names = [
      ...new Set(
        selected
          .filter((path) => path.startsWith(`${directory}/`))
          .map((path) => path.slice(directory.length + 1).split('/')[0])
      )
    ].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    for (const name of names) {
      const path = `${directory}/${name}`
      if (!selected.includes(path)) {
        collect(path)
      } else if (
        !name.endsWith('.md') &&
        (!name.endsWith('.test.ts') || RECORDING_DRIVERS.includes(name))
      ) {
        files.push(path)
      }
    }
  }
  collect(root)
  if (!files.length) {
    throw new Error('Empty recorder input domain')
  }
  return hash(
    files.map((file) => `${file}:${read(file).toString('utf8').replace(/\r\n/g, '\n')}`).join('\n')
  )
}
export function adapterInputDigest(sources, read) {
  const ordered = [...new Set(sources)].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0
  )
  if (!ordered.length || ordered.some((path) => !/^[a-z0-9-]+\.ts$/.test(path))) {
    throw new Error('Invalid adapter source domain')
  }
  return hash(
    ordered
      .map(
        (source) =>
          `${source}:${read(`mobile/src/test-support/rpc-recording/adapters/${source}`).toString('utf8').replace(/\r\n/g, '\n')}`
      )
      .join('\n')
  )
}
export function recordingInputEvidence(paths, read) {
  const { scenarios } = decodeScenarioInput(
    JSON.parse(read('mobile/rpc-foundation/pilot-scenarios.json').toString('utf8'))
  )
  const plan = recordingDomainPlan(scenarios)
  const adapters = Object.fromEntries(
    scenarios.map((scenario) => {
      const source = RECORDING_ADAPTER_OWNERS[scenario.operation]
      if (!source) {
        throw new Error(`No declared adapter owns ${scenario.operation}`)
      }
      return [scenario.operation, adapterInputDigest([source], read)]
    })
  )
  return {
    digests: {
      recorderSha256: recorderInputDigest(paths, read),
      scenariosSha256: scenarioInputDigest(scenarios),
      adapterSha256ByOperation: adapters
    },
    supportedIds: plan.map((item) => item.id).sort(),
    operations: Object.fromEntries(plan.map((item) => [item.id, item.base.operation]))
  }
}

export function matrixSites(base) {
  const frames = new Map()
  return base.steps.flatMap((step, index) => {
    if ('complete' in step) {
      return [{ id: step.complete, index, reply: step.reply }]
    }
    if ('frame' in step) {
      const occurrence = (frames.get(step.frame) ?? 0) + 1
      frames.set(step.frame, occurrence)
      return [{ id: `${step.frame}@${occurrence}`, index, reply: step.reply }]
    }
    return []
  })
}
export function replyMatrixSites(base) {
  const sites = matrixSites(base).map((site) => site.id)
  if (!sites.length) {
    throw new Error(`No scripted reply to drive a matrix over: ${base.id}`)
  }
  const repeated = sites.filter((name, index) => sites.indexOf(name) !== index)
  if (repeated.length) {
    throw new Error(`Matrix sites must be unique: ${base.id} repeats ${repeated.join(', ')}`)
  }
  return sites
}
export function replyMatrixGoldenId(family, request) {
  return `matrix-${family}-${request}`.toLowerCase().replaceAll('#', '-').replaceAll('@', '-')
}
const SIBLINGS = [
  'b3',
  'settings-new-tab-ssh',
  'settings-home-providers-fulfilled',
  'settings-workspace-context-fulfilled',
  'settings-resume-metadata-fulfilled',
  'settings-task-hydration-fulfilled',
  'settings-repo-metadata-fulfilled'
]
const INTERRUPTIONS = ['inventory-lifecycle', 'settings-bot-overrides-fulfilled']
const LIFECYCLES = [
  'inventory-lifecycle',
  'b3',
  'settings-bot-overrides-fulfilled',
  'settings-workspace-context-fulfilled',
  'settings-task-hydration-fulfilled'
]
/** The live recorder and frozen verifier consume this same domain plan. */
export function recordingDomainPlan(manifest) {
  const result = manifest.map((base) => ({ kind: 'pilot', id: base.id, family: base.family, base }))
  const families = new Map()
  for (const scenario of manifest) {
    families.set(scenario.family, [...(families.get(scenario.family) ?? []), scenario])
  }
  for (const [family, scenarios] of families) {
    const [base] = scenarios
    for (const site of replyMatrixSites(base)) {
      result.push({
        kind: 'matrix',
        id: replyMatrixGoldenId(family, site),
        family,
        base,
        site,
        scenarios
      })
    }
  }
  const find = (id) => {
    const base = manifest.find((scenario) => scenario.id === id)
    if (!base) {
      throw new Error(`No scenario named ${id}`)
    }
    return base
  }
  for (const id of SIBLINGS) {
    const base = find(id)
    const replies = base.steps.filter((step) => 'complete' in step)
    const first = replies.find((step) =>
      step.complete.startsWith(id === 'b3' ? 'linear.getIssue' : 'settings.get')
    )
    if (!first) {
      throw new Error(`No prerequisite completion to order siblings against: ${id}`)
    }
    const second = replies[replies.indexOf(first) + 1]
    if (second) {
      result.push({
        kind: 'sibling',
        id: `schedules-${id}`,
        family: base.family,
        base,
        first,
        second
      })
    }
  }
  for (const id of INTERRUPTIONS) {
    const base = find(id)
    result.push({ kind: 'interruption', id: `interruptions-${id}`, family: base.family, base })
  }
  for (const id of LIFECYCLES) {
    const base = find(id)
    result.push({
      kind: 'lifecycle',
      id: `lifecycle-${id}`,
      family: base.family,
      base,
      actions: id.includes('hydration')
        ? ['unmount']
        : id.includes('context')
          ? ['unmount', 'blur']
          : ['reset', 'unmount', 'blur']
    })
  }
  if (new Set(result.map((item) => item.id)).size !== result.length) {
    throw new Error('Duplicate derived golden ids')
  }
  return result
}

export const OBSERVATION_FIELD_KINDS = Object.freeze({
  sender: 'list',
  payloads: 'list',
  settlements: 'map',
  state: 'whole',
  effects: 'list'
})
export const OBSERVATION_FIELDS = Object.freeze(Object.keys(OBSERVATION_FIELD_KINDS))
export function valueHash(value) {
  return hash(canonicalRecordingJson(value)).slice(0, 12)
}
export function resolveRecording(values, recording) {
  // Content addressing is what keeps an entry shared between checkpoints honest: editing a pooled
  // value without moving every reference to it is caught here rather than resolving silently.
  for (const [hash, value] of Object.entries(values)) {
    if (valueHash(value) !== hash) {
      throw new Error(`Golden value ${hash} does not hash to its pool key`)
    }
  }
  const referenced = new Set()
  const resolve = (hash, at) => {
    if (typeof hash !== 'string' || !Object.hasOwn(values, hash)) {
      throw new Error(`Golden value ${JSON.stringify(hash)} is missing from the pool (${at})`)
    }
    referenced.add(hash)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the hash was resolved against the same pool that interned it.
    return values[hash]
  }
  const resolved = {
    scenario: recording.scenario,
    checkpoints: recording.checkpoints.map((checkpoint) => {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: every declared field is assigned below before the value is read.
      const observation = {}
      for (const field of OBSERVATION_FIELDS) {
        const interned = checkpoint.observation[field]
        const at = `${checkpoint.id}.${field}`
        if (OBSERVATION_FIELD_KINDS[field] === 'list') {
          if (!Array.isArray(interned)) {
            throw new Error(`Golden field ${at} is not a list of pool hashes`)
          }
          observation[field] = interned.map((hash, index) => resolve(hash, `${at}[${index}]`))
        } else if (OBSERVATION_FIELD_KINDS[field] === 'map') {
          if (interned === null || typeof interned !== 'object' || Array.isArray(interned)) {
            throw new Error(`Golden field ${at} is not a map of pool hashes`)
          }
          observation[field] = Object.fromEntries(
            Object.entries(interned).map(([key, hash]) => [key, resolve(hash, `${at}.${key}`)])
          )
        } else {
          observation[field] = resolve(interned, at)
        }
      }
      return { id: checkpoint.id, observation }
    })
  }
  // An entry no checkpoint reads is content in the file that nothing compares.
  const orphans = Object.keys(values).filter((hash) => !referenced.has(hash))
  if (orphans.length) {
    throw new Error(`Golden pool holds unreferenced values: ${orphans.join(', ')}`)
  }
  return resolved
}

export function decodeRecordingGolden(file, id) {
  if (
    !file ||
    typeof file !== 'object' ||
    Array.isArray(file) ||
    file.goldenFormatVersion !== 6 ||
    typeof file.operation !== 'string' ||
    typeof file.family !== 'string' ||
    !Array.isArray(file.namedDeltas) ||
    file.namedDeltas.some((value) => typeof value !== 'string') ||
    !file.values ||
    typeof file.values !== 'object' ||
    !file.recording ||
    typeof file.recording !== 'object'
  ) {
    throw new Error(`Invalid format-6 golden: ${id}`)
  }
  if (
    Object.keys(file).sort().join(',') !==
    'family,goldenFormatVersion,namedDeltas,operation,recording,values'
  ) {
    throw new Error(`Unexpected format-6 fields: ${id}`)
  }
  const recording = resolveRecording(file.values, file.recording)
  if (recording.scenario !== id) {
    throw new Error(`Golden scenario identity mismatch: ${id}`)
  }
  return {
    goldenFormatVersion: 6,
    operation: file.operation,
    family: file.family,
    namedDeltas: file.namedDeltas,
    recording
  }
}
