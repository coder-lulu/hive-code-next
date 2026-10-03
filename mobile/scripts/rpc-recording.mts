/** Record current Hive behavior from a frozen source commit into reviewable scratch evidence. */
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runProcess } from '../../src/shared/child-process/run-process.ts'
import { derivedGoldens } from '../src/test-support/rpc-recording/derived-goldens.ts'
import { RECORDING_DRIVERS } from '../src/test-support/rpc-recording/recording-drivers.ts'
import { readScenarios } from '../src/test-support/rpc-recording/scenario-input.ts'
import { adapterSha256 } from '../src/test-support/rpc-recording/adapter-digest.ts'
import { recorderSha256 } from '../src/test-support/rpc-recording/recorder-digest.ts'
import { scenarioSha256 } from '../src/test-support/rpc-recording/scenario-digest.ts'
import { writeHiveRecordingOverlay } from '../rpc-foundation/write-hive-recording-overlay.ts'
import { assertRecordingSources } from '../rpc-foundation/recording-source-fence.ts'

const [mode, sourceBaseline, upstreamBaseline, ...options] = process.argv.slice(2)
if (
  !['--record-hive', '--publish-hive'].includes(mode ?? '') ||
  process.env.RPC_FOUNDATION_RECORD !== '1' ||
  !/^[a-f0-9]{40}$/.test(sourceBaseline ?? '') ||
  !/^[a-f0-9]{40}$/.test(upstreamBaseline ?? '')
) {
  throw new Error(
    'Use --record-hive|--publish-hive <source-sha> <upstream-sha> with RPC_FOUNDATION_RECORD=1'
  )
}
const evidenceOnly = options.includes('--evidence-only')
const ids = options.filter((arg) => arg !== '--evidence-only')
if (ids.some((arg) => arg.startsWith('-')) || (mode === '--publish-hive' && options.length)) {
  throw new Error('Recording accepts golden ids and --evidence-only; publication accepts neither')
}
const root = resolve(import.meta.dirname, '../..')
assertRecordingSources(root, sourceBaseline, true)
const input = readScenarios(resolve(root, 'mobile/rpc-foundation/pilot-scenarios.json'))
const derived = new Set(derivedGoldens(input.scenarios).map((golden) => golden.id))
const unknownIds = ids.filter((id) => !derived.has(id))
if (unknownIds.length) {
  throw new Error(`The product manifest derives no golden named ${unknownIds.join(', ')}`)
}
const output = resolve(root, 'logs/upstream-sync/hive-rpc-recording', sourceBaseline)
const goldens = resolve(output, 'goldens')
const adapterSha256ByOperation = Object.fromEntries(
  input.scenarios.map((scenario) => [scenario.operation, adapterSha256(root, [scenario])])
)
const provenance = {
  baseline: sourceBaseline,
  upstreamBaseline,
  recorderSha256: recorderSha256(root),
  scenariosSha256: scenarioSha256(input.scenarios),
  adapterSha256ByOperation
}
function publishCompleteRecording() {
  const recordedIds = readdirSync(goldens)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -5))
    .sort()
  if (JSON.stringify(recordedIds) !== JSON.stringify([...derived].sort())) {
    throw new Error('Publication requires the complete current product-supported recording domain')
  }
  writeHiveRecordingOverlay(root, sourceBaseline, goldens)
}
if (mode === '--publish-hive') {
  const recorded = JSON.parse(readFileSync(resolve(output, 'provenance.json'), 'utf8'))
  if (JSON.stringify(recorded) !== JSON.stringify(provenance)) {
    throw new Error('Recording provenance differs from the frozen source or upstream commit')
  }
  publishCompleteRecording()
} else {
  mkdirSync(output, { recursive: true })
  writeFileSync(resolve(output, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n')
  const require = createRequire(resolve(root, 'mobile/package.json'))
  const escape = (id: string) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Keep Windows cold-cache headroom and stream output so multi-minute failures retain their tail.
  const timeoutMs = 1_200_000
  const result = await runProcess({
    program: process.execPath,
    args: [
      resolve(require.resolve('vitest/package.json'), '../vitest.mjs'),
      'run',
      ...RECORDING_DRIVERS.map((driver) => `src/test-support/rpc-recording/${driver}`),
      ...(ids.length ? ['-t', `(?:^| )(?:${ids.map(escape).join('|')}): `] : [])
    ],
    cwd: resolve(root, 'mobile'),
    timeoutMs,
    env: {
      ...process.env,
      ORCA_BACKGROUND_LAUNCH: '1',
      RPC_FOUNDATION_MODE: '--record',
      RPC_FOUNDATION_SCENARIOS: resolve(root, 'mobile/rpc-foundation/pilot-scenarios.json'),
      RPC_FOUNDATION_GOLDENS: goldens
    },
    stdio: 'inherit'
  })
  if (result.timedOut) {
    throw new Error(`Recording did not finish within ${timeoutMs / 1000}s and was killed.`)
  }
  if (result.code !== 0) {
    process.exitCode = 1
  } else {
    assertRecordingSources(root, sourceBaseline, true)
    // A partial run remains evidence only; publishing it would shrink the supported domain.
    if (!evidenceOnly && ids.length === 0) {
      publishCompleteRecording()
    }
  }
}
