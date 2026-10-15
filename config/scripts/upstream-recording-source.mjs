import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { verifyUpstreamTreeSync } from './upstream-tree-sync.mjs'
import { recordingInputEvidence, decodeRecordingGolden } from './upstream-recording-inputs.mjs'
import { verifyRecordingCorpus } from './upstream-recording-corpus.mjs'
import { CONTROL_PATHS } from './upstream-recording-controls.mjs'
import {
  requireValue,
  exactKeys,
  git,
  treeEntries,
  blobBytes,
  sha256,
  recordingProjection,
  recordingControlProjection
} from './upstream-recording-raw.mjs'
export { CONTROL_PATHS }
export {
  guardedPath,
  recordingProjection,
  exportRecordingSources,
  assertRecordingFixture,
  assertRecordingOutput,
  sha256,
  recordingControlProjection,
  exportRecordingControls,
  assertRecordingControls
} from './upstream-recording-raw.mjs'
const SHA = /^[a-f0-9]{40}$/
const DIGEST = /^[a-f0-9]{64}$/
const FOUNDATION = 'mobile/rpc-foundation'
const MANIFEST = `${FOUNDATION}/hive/manifest.json`
export function decodeRecordingSource(value) {
  exactKeys(
    value,
    [
      'kind',
      'controlSha',
      'upstreamSha',
      'guardVersion',
      'guardedSourcesSha256',
      'guardedFileCount'
    ],
    'recording source'
  )
  requireValue(
    value.kind === 'tree-sync-content' &&
      typeof value.controlSha === 'string' &&
      typeof value.upstreamSha === 'string' &&
      typeof value.guardedSourcesSha256 === 'string' &&
      SHA.test(value.controlSha) &&
      SHA.test(value.upstreamSha) &&
      value.guardVersion === 1 &&
      DIGEST.test(value.guardedSourcesSha256) &&
      Number.isSafeInteger(value.guardedFileCount) &&
      value.guardedFileCount > 0,
    'Invalid tree-sync recording source'
  )
  return value
}
export function decodeRecordingManifest(value) {
  const common = [
    'version',
    'upstreamGoldensSha256',
    'recorderSha256',
    'scenariosSha256',
    'adapterSha256ByOperation',
    'overlays'
  ]
  if (value?.version === 2) {
    exactKeys(value, [...common, 'baseline', 'upstreamBaseline'], 'historical v2 manifest')
    requireValue(
      SHA.test(value.baseline) && SHA.test(value.upstreamBaseline),
      'Invalid historical v2 source'
    )
  } else {
    exactKeys(value, [...common, 'source', 'reviewedDeltasSha256'], 'v3 manifest')
    requireValue(
      value.version === 3 && DIGEST.test(value.reviewedDeltasSha256),
      'Invalid v3 manifest'
    )
    decodeRecordingSource(value.source)
  }
  for (const key of ['upstreamGoldensSha256', 'recorderSha256', 'scenariosSha256']) {
    requireValue(DIGEST.test(value[key]), `Invalid ${key}`)
  }
  requireValue(
    value.adapterSha256ByOperation &&
      !Array.isArray(value.adapterSha256ByOperation) &&
      typeof value.adapterSha256ByOperation === 'object' &&
      Object.keys(value.adapterSha256ByOperation).length > 0 &&
      Object.values(value.adapterSha256ByOperation).every(
        (digest) => typeof digest === 'string' && DIGEST.test(digest)
      ),
    'Invalid adapter digests'
  )
  requireValue(
    value.overlays && typeof value.overlays === 'object' && !Array.isArray(value.overlays),
    'Invalid overlays'
  )
  for (const [id, overlay] of Object.entries(value.overlays)) {
    exactKeys(overlay, ['sha256', 'reason'], 'overlay')
    requireValue(
      /^[a-z0-9][a-z0-9._-]*$/.test(id) &&
        DIGEST.test(overlay.sha256) &&
        typeof overlay.reason === 'string' &&
        overlay.reason.trim(),
      'Invalid overlay identity/review'
    )
  }
  return value
}
export function verifyRecordingSource(options) {
  for (const key of ['target', 'upstream', 'head']) {
    requireValue(SHA.test(options[key]), `Recording verification requires exact ${key}`)
  }
  // No supplied receipt or F is accepted. This is the original full merge recomputation.
  const verified = verifyUpstreamTreeSync(options)
  const content = verified.contentCommitSha
  requireValue(content && SHA.test(content), 'Recording verification requires a content commit')
  const cwd = options.cwd ?? process.cwd()
  const entries = treeEntries(cwd, content)
  const relevant = entries.filter(
    ({ path }) =>
      path.startsWith('mobile/rpc-foundation/') ||
      path.startsWith('mobile/src/test-support/rpc-recording/')
  )
  const bytes = blobBytes(
    cwd,
    relevant.map((entry) => entry.blob)
  )
  const byPath = new Map(relevant.map((entry) => [entry.path, entry.blob]))
  const read = (path) => {
    const value = bytes.get(byPath.get(path))
    requireValue(value, `Missing recording input: ${path}`)
    return value
  }
  const manifest = decodeRecordingManifest(JSON.parse(read(MANIFEST).toString('utf8')))
  requireValue(manifest.version === 3, 'New tree-sync candidates require v3 recording provenance')
  const source = manifest.source
  requireValue(source.upstreamSha === options.upstream, 'Recording upstream identity mismatch')
  git(cwd, ['merge-base', '--is-ancestor', source.controlSha, options.target])
  const parents = git(cwd, ['show', '-s', '--format=%P', content]).toString('ascii').trim()
  requireValue(
    parents === options.target,
    'Recording content parent differs from frozen review target'
  )
  const control = new Map(treeEntries(cwd, source.controlSha).map((entry) => [entry.path, entry]))
  const target = new Map(treeEntries(cwd, options.target).map((entry) => [entry.path, entry]))
  for (const path of CONTROL_PATHS) {
    requireValue(
      control.has(path) &&
        target.has(path) &&
        JSON.stringify(control.get(path)) === JSON.stringify(target.get(path)),
      `Recording control closure changed: ${path}`
    )
  }
  const controlProjection = recordingControlProjection(cwd, source.controlSha)
  for (const { path } of controlProjection.entries) {
    requireValue(
      JSON.stringify(control.get(path)) === JSON.stringify(target.get(path)),
      `Recording executable control closure changed: ${path}`
    )
    requireValue(
      JSON.stringify(entries.find((entry) => entry.path === path)) ===
        JSON.stringify(target.get(path)),
      `Candidate changed frozen recording algorithm/ownership: ${path}`
    )
  }
  const projection = recordingProjection(cwd, content)
  requireValue(
    projection.guardedSourcesSha256 === source.guardedSourcesSha256 &&
      projection.guardedFileCount === source.guardedFileCount,
    'Recording source projection differs from verified content'
  )
  requireValue(
    sha256(read(`${FOUNDATION}/hive/reviewed-deltas.json`)) === manifest.reviewedDeltasSha256,
    'Reviewed deltas changed after recording review'
  )
  const inputs = recordingInputEvidence(
    entries.map((entry) => entry.path),
    read
  )
  requireValue(
    JSON.stringify(inputs.digests) ===
      JSON.stringify({
        recorderSha256: manifest.recorderSha256,
        scenariosSha256: manifest.scenariosSha256,
        adapterSha256ByOperation: manifest.adapterSha256ByOperation
      }),
    'Recording input digests differ from verified source'
  )
  const originals = entries.filter(
    ({ path }) => path.startsWith(`${FOUNDATION}/goldens/`) && path.endsWith('.json')
  )
  const baseEntries = treeEntries(cwd, verified.receipt.baseUpstreamSha)
  const upstreamEntries = treeEntries(cwd, options.upstream)
  const review = JSON.parse(
    git(cwd, ['show', `${options.target}:config/upstream-tree-review.json`]).toString('utf8')
  )
  verifyRecordingCorpus(
    baseEntries,
    [...target.values()],
    upstreamEntries,
    entries,
    review.resolutions
  )
  const corpus = originals
    .map(
      ({ path }) =>
        `${path.slice(`${FOUNDATION}/goldens/`.length)}:${sha256(read(path).toString('utf8').replace(/\r\n/g, '\n'))}`
    )
    .sort()
    .join('\n')
  requireValue(
    sha256(corpus) === manifest.upstreamGoldensSha256,
    'Upstream golden corpus digest mismatch'
  )
  const reviewed = JSON.parse(read(`${FOUNDATION}/hive/reviewed-deltas.json`).toString('utf8'))
  const supported = originals
    .filter(({ path }) =>
      Object.hasOwn(inputs.digests.adapterSha256ByOperation, JSON.parse(read(path)).operation)
    )
    .map(({ path }) => path.slice(`${FOUNDATION}/goldens/`.length, -5))
    .sort()
  requireValue(
    JSON.stringify(supported) === JSON.stringify(inputs.supportedIds),
    'Supported recording domain differs from verified source'
  )
  for (const id of supported) {
    requireValue(
      JSON.parse(read(`${FOUNDATION}/goldens/${id}.json`)).operation === inputs.operations[id],
      `Scenario operation mismatch: ${id}`
    )
  }
  requireValue(
    reviewed.upstreamGoldensSha256 === manifest.upstreamGoldensSha256 &&
      JSON.stringify(Object.keys(reviewed.deltas).sort()) ===
        JSON.stringify(Object.keys(manifest.overlays).sort()),
    'Reviewed overlay domain mismatch'
  )
  const actualOverlays = entries
    .filter(({ path }) => path.startsWith(`${FOUNDATION}/hive/goldens/`))
    .map(({ path }) => path.slice(`${FOUNDATION}/hive/goldens/`.length))
  requireValue(
    JSON.stringify(actualOverlays.sort()) ===
      JSON.stringify(
        Object.keys(manifest.overlays)
          .map((id) => `${id}.json`)
          .sort()
      ),
    'Sparse overlay file domain mismatch'
  )
  for (const [id, overlay] of Object.entries(manifest.overlays)) {
    requireValue(supported.includes(id), `Overlay outside supported recording domain: ${id}`)
    const before = decodeRecordingGolden(JSON.parse(read(`${FOUNDATION}/goldens/${id}.json`)), id)
    const after = decodeRecordingGolden(
      JSON.parse(read(`${FOUNDATION}/hive/goldens/${id}.json`)),
      id
    )
    for (const key of ['operation', 'family', 'namedDeltas', 'goldenFormatVersion']) {
      requireValue(
        JSON.stringify(before[key]) === JSON.stringify(after[key]),
        `Overlay scenario contract changed: ${id}`
      )
    }
    const beforeHash = sha256(JSON.stringify(before.recording))
    const afterHash = sha256(JSON.stringify(after.recording))
    requireValue(
      beforeHash !== afterHash &&
        reviewed.deltas[id].upstreamTraceSha256 === beforeHash &&
        reviewed.deltas[id].hiveTraceSha256 === afterHash,
      `Reviewed trace hashes differ: ${id}`
    )
    requireValue(
      sha256(read(`${FOUNDATION}/hive/goldens/${id}.json`)) === overlay.sha256 &&
        reviewed.deltas[id].reason === overlay.reason,
      `Recording overlay/review mismatch: ${id}`
    )
  }
  return {
    schemaVersion: 1,
    check: 'recording-source',
    passed: true,
    targetSha: options.target,
    upstreamSha: options.upstream,
    candidateSha: options.head,
    controlSha: source.controlSha,
    contentCommitSha: content,
    guardedSourcesSha256: projection.guardedSourcesSha256,
    guardedFileCount: projection.guardedFileCount,
    controlSourcesSha256: controlProjection.controlSourcesSha256,
    controlFileCount: controlProjection.controlFileCount
  }
}
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    const [command, ...args] = process.argv.slice(2)
    requireValue(command === 'verify', 'Expected recording-source verify')
    const options = {}
    let report
    for (let index = 0; index < args.length; index += 2) {
      const key = args[index].replace(/^--/, '')
      requireValue(
        ['cwd', 'target', 'upstream', 'head', 'report', 'target-branch'].includes(key) &&
          args[index + 1],
        'Invalid recording-source argument'
      )
      if (key === 'report') {
        report = args[index + 1]
      } else {
        options[key === 'target-branch' ? 'targetBranch' : key] = args[index + 1]
      }
    }
    const result = verifyRecordingSource(options)
    if (report) {
      mkdirSync(dirname(resolve(report)), { recursive: true })
      writeFileSync(report, `${JSON.stringify(result, null, 2)}\n`)
    } else {
      process.stdout.write(`${JSON.stringify(result)}\n`)
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
