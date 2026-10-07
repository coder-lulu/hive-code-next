import type { Readable } from 'node:stream'
import {
  createIncrementalNdjsonFramer,
  type NdjsonRejectedRecord
} from '../../shared/main-process-ndjson-framer'
import { CodexAppServerFrameSizeError } from './codex-app-server-frame-size-error'

type RecordReaderStream = Pick<Readable, 'on' | 'pause' | 'resume' | 'setEncoding'>

export type CodexAppServerRecordReader = {
  pause: () => void
  resume: () => void
}

export function createCodexAppServerRecordReader(input: {
  stdout: RecordReaderStream
  onRecord: (record: unknown, line: string) => void
  onRejected: (rejected: NdjsonRejectedRecord) => void
  onFatal: (error: Error) => void
  maxLineBytes?: number
}): CodexAppServerRecordReader {
  let paused = false
  let failed = false
  const fail = (error: Error): void => {
    if (failed) {
      return
    }
    failed = true
    input.stdout.pause()
    input.onFatal(error)
  }
  const framer = createIncrementalNdjsonFramer(
    (record, line) => {
      if (!failed) {
        input.onRecord(record, line)
      }
    },
    (rejected) => {
      if (failed) {
        return
      }
      if (input.maxLineBytes !== undefined && rejected.kind === 'line-too-long') {
        fail(new CodexAppServerFrameSizeError(null, rejected.observedBytes, rejected.maxLineBytes))
      } else {
        input.onRejected(rejected)
      }
    },
    {
      // Personal provider streams retain their existing fidelity; boundary transports
      // must bound both incomplete lines and the paused complete-record queue.
      maxLineBytes: input.maxLineBytes ?? Number.POSITIVE_INFINITY,
      shouldPause: () => paused || failed
    }
  )

  input.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    if (failed) {
      return
    }
    try {
      framer.feed(chunk)
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)))
    } finally {
      if (failed) {
        // A fatal callback may have paused mid-chunk; release its queued suffix too.
        framer.reset()
      }
    }
  })

  return {
    pause: () => {
      paused = true
      input.stdout.pause()
    },
    resume: () => {
      if (!paused || failed) {
        return
      }
      paused = false
      try {
        framer.resume()
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
      } finally {
        if (failed) {
          framer.reset()
        }
      }
      if (!paused && !failed) {
        input.stdout.resume()
      }
    }
  }
}
