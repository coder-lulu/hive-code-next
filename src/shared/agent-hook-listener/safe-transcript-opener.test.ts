import { execFileSync } from 'node:child_process'
import { closeSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { platform } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openRegularTranscript } from './safe-transcript-opener'

const roots: string[] = []
const fixtureDirectory = resolve(process.cwd(), 'logs', 'upstream-sync', 'safe-transcript-opener')
afterEach(() => {
  for (const root of roots) {
    if (dirname(root) !== fixtureDirectory || !basename(root).startsWith('case-')) {
      throw new Error('unsafe transcript test cleanup path')
    }
    rmSync(root, { recursive: true, force: true })
  }
  roots.length = 0
})

function fixture(): string {
  mkdirSync(fixtureDirectory, { recursive: true })
  const root = mkdtempSync(join(fixtureDirectory, 'case-'))
  roots.push(root)
  return root
}

describe('openRegularTranscript', () => {
  it('opens a regular file and reports its size from the same descriptor', () => {
    const path = join(fixture(), 'transcript.jsonl')
    writeFileSync(path, 'hello')
    const opened = openRegularTranscript(path)
    expect(opened?.stats.isFile()).toBe(true)
    expect(opened?.stats.size).toBe(5)
    if (opened) {
      closeSync(opened.fd)
    }
  })

  it('rejects symlinks and directories without reading them', () => {
    const root = fixture()
    const target = join(root, 'secret')
    const link = join(root, 'transcript.jsonl')
    writeFileSync(target, 'secret')
    mkdirSync(join(root, 'directory'))
    if (platform() !== 'win32') {
      symlinkSync(target, link)
      expect(openRegularTranscript(link)).toBeUndefined()
    }
    expect(openRegularTranscript(join(root, 'directory'))).toBeUndefined()
  })

  it('rejects a FIFO without waiting for a writer on Unix', () => {
    if (platform() === 'win32') {
      return
    }
    const fifo = join(fixture(), 'transcript.pipe')
    execFileSync('mkfifo', [fifo])
    expect(openRegularTranscript(fifo)).toBeUndefined()
  })
})
