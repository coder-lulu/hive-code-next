import { getMainHttpClient } from '../../network/http-client'
import type {
  HiveRuntimeRelayRegionMeasurement,
  HiveRuntimeRelayRegionMeasurementWindow
} from './hive-runtime-relay-heartbeat-types'

const MAXIMUM_CANDIDATES = 8
const MAXIMUM_CONCURRENCY = 3
const PROBE_TIMEOUT_MS = 4_000
const MAXIMUM_LATENCY_MS = 60_000

type FetchLike = (
  input: string,
  init: Readonly<{
    method: 'GET'
    cache: 'no-store'
    redirect: 'error'
    signal: AbortSignal
  }>
) => Promise<Pick<Response, 'body'>>

export async function measureHiveRuntimeRelayRegions(
  window: HiveRuntimeRelayRegionMeasurementWindow,
  options: Readonly<{
    fetch?: FetchLike
    now?: () => number
    setTimer?: typeof setTimeout
    clearTimer?: typeof clearTimeout
  }> = {}
): Promise<HiveRuntimeRelayRegionMeasurement> {
  const fetcher = options.fetch ?? ((input, init) => getMainHttpClient().fetch(input, init))
  const now = options.now ?? Date.now
  const setTimer = options.setTimer ?? setTimeout
  const clearTimer = options.clearTimer ?? clearTimeout
  if (
    window.candidates.length < 2 ||
    window.candidates.length > MAXIMUM_CANDIDATES ||
    window.expiresAt <= now()
  ) {
    return inconclusive(window, 'INCOMPLETE')
  }

  const measurements = Array.from<
    { length: number },
    { region: string; latencyMillis: number } | null
  >({ length: window.candidates.length }, () => null)
  let nextIndex = 0
  let failure: 'TIMEOUT' | 'NETWORK_ERROR' | null = null
  const worker = async (): Promise<void> => {
    while (failure === null) {
      const index = nextIndex++
      const candidate = window.candidates[index]
      if (!candidate) {
        return
      }
      const abort = new AbortController()
      const timer = setTimer(() => abort.abort(), PROBE_TIMEOUT_MS)
      timer.unref?.()
      const startedAt = now()
      try {
        const response = await fetcher(candidate.probeUrl, {
          method: 'GET',
          cache: 'no-store',
          redirect: 'error',
          signal: abort.signal
        })
        await response.body?.cancel()
        const elapsed = Math.max(1, Math.min(MAXIMUM_LATENCY_MS, Math.ceil(now() - startedAt)))
        measurements[index] = { region: candidate.region, latencyMillis: elapsed }
      } catch (error) {
        failure =
          abort.signal.aborted || (error instanceof Error && error.name === 'AbortError')
            ? 'TIMEOUT'
            : 'NETWORK_ERROR'
      } finally {
        clearTimer(timer)
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(MAXIMUM_CONCURRENCY, window.candidates.length) }, () => worker())
  )
  if (failure !== null || measurements.some((measurement) => measurement === null)) {
    return inconclusive(window, failure ?? 'INCOMPLETE')
  }
  return {
    policyVersion: 1,
    windowGeneration: window.generation,
    assignmentId: window.assignmentId,
    assignmentEpoch: window.assignmentEpoch,
    incumbentRegion: window.incumbentRegion,
    outcome: 'CONCLUSIVE',
    measurements: measurements.filter((measurement) => measurement !== null),
    failure: null
  }
}

function inconclusive(
  window: HiveRuntimeRelayRegionMeasurementWindow,
  failure: 'TIMEOUT' | 'NETWORK_ERROR' | 'INCOMPLETE'
): HiveRuntimeRelayRegionMeasurement {
  return {
    policyVersion: 1,
    windowGeneration: window.generation,
    assignmentId: window.assignmentId,
    assignmentEpoch: window.assignmentEpoch,
    incumbentRegion: window.incumbentRegion,
    outcome: 'INCONCLUSIVE',
    measurements: [],
    failure
  }
}
