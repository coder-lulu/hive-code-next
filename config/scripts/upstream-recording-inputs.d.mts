import type {
  ValuePool,
  InternedRecording
} from '../../mobile/src/test-support/rpc-recording/golden-value-pool'
import type { GoldenRecording } from '../../mobile/src/test-support/rpc-recording/golden-recording'
import type {
  Recording,
  RecordingScenario,
  ScenarioStep
} from '../../mobile/src/test-support/rpc-recording/recording-scenario'
import type { RecordedValue } from '../../mobile/src/test-support/rpc-recording/recording-values'
export function captureScenarioValue(value: unknown): RecordedValue
export function canonicalRecordingJson(value: RecordedValue): string
export function scenarioInputDigest(scenarios: readonly RecordingScenario[]): string
export function decodeScenarioInput(raw: unknown): { scenarios: RecordingScenario[] }
export const RECORDING_DRIVERS: readonly ['pilot-recordings.test.ts', 'family-recordings.test.ts']
export function recorderInputDigest(paths: string[], read: (path: string) => Buffer): string
export function adapterInputDigest(sources: string[], read: (path: string) => Buffer): string
export function recordingInputEvidence(
  paths: string[],
  read: (path: string) => Buffer
): {
  digests: {
    recorderSha256: string
    scenariosSha256: string
    adapterSha256ByOperation: Record<string, string>
  }
  supportedIds: string[]
  operations: Record<string, string>
}
export function matrixSites(
  base: RecordingScenario
): { id: string; index: number; reply: unknown }[]
export function replyMatrixSites(base: RecordingScenario): string[]
export function replyMatrixGoldenId(family: string, request: string): string
type BasePlan = { id: string; family: string; base: RecordingScenario }
export type RecordingDomainPlan = BasePlan &
  (
    | { kind: 'pilot' }
    | { kind: 'matrix'; site: string; scenarios: RecordingScenario[] }
    | {
        kind: 'sibling'
        first: Extract<ScenarioStep, { complete: string }>
        second: Extract<ScenarioStep, { complete: string }>
      }
    | { kind: 'interruption' }
    | { kind: 'lifecycle'; actions: ('reset' | 'unmount' | 'blur')[] }
  )
export function recordingDomainPlan(manifest: readonly RecordingScenario[]): RecordingDomainPlan[]
export const OBSERVATION_FIELD_KINDS: Readonly<{
  sender: 'list'
  payloads: 'list'
  settlements: 'map'
  state: 'whole'
  effects: 'list'
}>
export const OBSERVATION_FIELDS: readonly ['sender', 'payloads', 'settlements', 'state', 'effects']
export function valueHash(value: RecordedValue): string
export function resolveRecording(values: ValuePool, recording: InternedRecording): Recording
export function decodeRecordingGolden(file: unknown, id: string): GoldenRecording
