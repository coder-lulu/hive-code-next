import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createCellObservationReader } from './hive-account-relay-observation'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) {
    expect(dirname(resolve(directory))).toBe(resolve(tmpdir()))
    expect(basename(directory)).toMatch(/^hive-cell-observation-/)
    rmSync(directory, { recursive: true, force: true })
  }
})

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'hive-cell-observation-'))
  directories.push(directory)
  const path = join(directory, 'observation.json')
  let now = 10_000
  const reader = createCellObservationReader(path, () => now)
  const write = () =>
    writeFileSync(path, JSON.stringify({ observedAt: now, metrics: { owners: 30 } }))
  return {
    path,
    reader,
    write,
    advance: (ms: number) => {
      now += ms
    }
  }
}

it('bridges a short replacement gap, records it and reads the replacement', () => {
  const f = fixture()
  f.write()
  const previous = f.reader.read()
  unlinkSync(f.path)
  f.advance(1000)
  expect(f.reader.read()).toEqual(previous)
  expect(f.reader.gaps()).toEqual([{ at: 11_000, observedAt: 10_000, ageMs: 1000 }])
  f.write()
  expect(f.reader.read().observedAt).toBe(11_000)
})

it('retries a transient replacement gap before using the cached snapshot', () => {
  let reads = 0
  const reader = createCellObservationReader('observation.json', () => 10_000, {
    readFile: () => {
      reads += 1
      if (reads === 1) {
        throw Object.assign(new Error('replacement gap'), { code: 'ENOENT' })
      }
      return JSON.stringify({ observedAt: 10_000, metrics: { owners: 30 } })
    },
    wait: () => undefined
  })

  expect(reader.read().observedAt).toBe(10_000)
  expect(reads).toBe(2)
  expect(reader.gaps()).toEqual([])
})

it('fails prolonged absence without extending freshness on cached reads', () => {
  const f = fixture()
  f.write()
  f.reader.read()
  unlinkSync(f.path)
  f.advance(1500)
  expect(f.reader.read().observedAt).toBe(10_000)
  f.advance(1)
  expect(() => f.reader.read()).toThrow(expect.objectContaining({ code: 'ENOENT' }))
})

it('does not mask initial absence or malformed replacements', () => {
  const f = fixture()
  expect(() => f.reader.read()).toThrow(expect.objectContaining({ code: 'ENOENT' }))
  f.write()
  f.reader.read()
  writeFileSync(f.path, '{')
  expect(() => f.reader.read()).toThrow(SyntaxError)
})
