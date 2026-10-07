import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodexAppServerFrameSizeError } from './codex-app-server-frame-size-error'
import { createCodexAppServerRecordReader } from './codex-app-server-record-reader'

const streams: PassThrough[] = []
afterEach(() => {
  for (const stream of streams.splice(0)) {
    stream.destroy()
  }
})

function boundedReader(maxLineBytes = 128) {
  const stdout = new PassThrough()
  streams.push(stdout)
  const onRecord = vi.fn()
  const onRejected = vi.fn()
  const onFatal = vi.fn()
  const reader = createCodexAppServerRecordReader({
    stdout,
    onRecord,
    onRejected,
    onFatal,
    maxLineBytes
  })
  return { stdout, onRecord, onRejected, onFatal, reader }
}

describe('bounded Codex stdout reader', () => {
  it('fails an unterminated line as soon as its encoded bytes exceed the bound', () => {
    const f = boundedReader(128)
    f.stdout.write('x'.repeat(120))
    expect(f.onFatal).not.toHaveBeenCalled()
    f.stdout.write('字'.repeat(3))
    expect(f.onFatal).toHaveBeenCalledExactlyOnceWith(
      new CodexAppServerFrameSizeError(null, 129, 128)
    )
    expect(f.stdout.isPaused()).toBe(true)
    expect(f.onRecord).not.toHaveBeenCalled()
  })

  it.each([
    { id: 2, result: 'x'.repeat(256) },
    { id: 'server', method: 'request', params: 'x'.repeat(256) },
    { method: 'notice', params: 'x'.repeat(256) }
  ])('never delivers an oversized record or a later record in its chunk: %j', (record) => {
    const f = boundedReader()
    f.stdout.write(`${JSON.stringify(record)}\n{"method":"later"}\n`)
    expect(f.onFatal).toHaveBeenCalledTimes(1)
    expect(f.onRecord).not.toHaveBeenCalled()
    expect(f.onRejected).not.toHaveBeenCalled()
    f.reader.resume()
    expect(f.stdout.isPaused()).toBe(true)
  })

  it('keeps a fatal retained record paused when reading resumes', () => {
    const f = boundedReader()
    f.onRecord.mockImplementationOnce(() => f.reader.pause())
    f.stdout.write(
      `{"method":"first"}\n${JSON.stringify({ method: 'oversized', params: 'x'.repeat(256) })}\n{"method":"later"}\n`
    )
    expect(f.onRecord).toHaveBeenCalledTimes(1)
    expect(f.onFatal).not.toHaveBeenCalled()
    f.reader.resume()
    expect(f.onFatal).toHaveBeenCalledTimes(1)
    expect(f.stdout.isPaused()).toBe(true)
    f.reader.resume()
    expect(f.onRecord).toHaveBeenCalledTimes(1)
    expect(f.onFatal).toHaveBeenCalledTimes(1)
  })

  it('contains a retained-record consumer exception and keeps the stream paused', () => {
    const f = boundedReader()
    const failure = new Error('retained consumer failed')
    f.onRecord
      .mockImplementationOnce(() => f.reader.pause())
      .mockImplementationOnce(() => {
        throw failure
      })
    f.stdout.write('{"method":"first"}\n{"method":"second"}\n{"method":"later"}\n')
    expect(() => f.reader.resume()).not.toThrow()
    expect(f.onFatal).toHaveBeenCalledExactlyOnceWith(failure)
    expect(f.stdout.isPaused()).toBe(true)
    f.reader.resume()
    expect(f.onRecord).toHaveBeenCalledTimes(2)
    expect(f.onFatal).toHaveBeenCalledTimes(1)
  })

  it('preserves ordered complete records and multibyte fragments within the bound', () => {
    const f = boundedReader()
    const first = { method: 'notice', params: '字'.repeat(3) }
    const line = Buffer.from(`${JSON.stringify(first)}\n{"id":2,"result":{}}\n`)
    f.stdout.write(line.subarray(0, 31))
    f.stdout.write(line.subarray(31))
    expect(f.onRecord.mock.calls.map(([record]) => record)).toEqual([first, { id: 2, result: {} }])
    expect(f.onFatal).not.toHaveBeenCalled()
  })
})
