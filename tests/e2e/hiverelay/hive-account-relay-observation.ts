import { readFileSync } from 'node:fs'

type CellObservation = {
  observedAt: number
  metrics: Record<string, number>
  status: { publicReady: boolean; cellIncarnationId: string }
}

type ObservationReadOptions = {
  readFile?: (path: string) => string
  wait?: (milliseconds: number) => void
}

const replacementRetryAttempts = 6
const replacementRetryDelayMs = 10
const retrySignal = new Int32Array(new SharedArrayBuffer(4))

function waitForReplacement(milliseconds: number) {
  Atomics.wait(retrySignal, 0, 0, milliseconds)
}

export function createCellObservationReader(
  path: string,
  now = Date.now,
  options: ObservationReadOptions = {}
) {
  const readFile = options.readFile ?? ((target: string) => readFileSync(target, 'utf8'))
  const wait = options.wait ?? waitForReplacement
  let latest: CellObservation | undefined
  const gaps: { at: number; observedAt: number; ageMs: number }[] = []
  return {
    read: () => {
      try {
        let contents: string | undefined
        for (let attempt = 1; attempt <= replacementRetryAttempts; attempt += 1) {
          try {
            contents = readFile(path)
            break
          } catch (error) {
            if (
              (error as NodeJS.ErrnoException).code !== 'ENOENT' ||
              attempt === replacementRetryAttempts
            ) {
              throw error
            }
            wait(replacementRetryDelayMs)
          }
        }
        const observation: CellObservation = JSON.parse(contents!)
        if (!Number.isFinite(observation?.observedAt)) {
          throw new Error('Invalid Cell observation timestamp')
        }
        latest = observation
        return observation
      } catch (error) {
        const at = now()
        const ageMs = latest ? at - latest.observedAt : Number.NaN
        if (
          (error as NodeJS.ErrnoException).code !== 'ENOENT' ||
          !latest ||
          ageMs < 0 ||
          ageMs > 1500
        ) {
          throw error
        }
        gaps.push({ at, observedAt: latest.observedAt, ageMs })
        return latest
      }
    },
    gaps: () => [...gaps]
  }
}
