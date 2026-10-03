import { closeSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { link, symlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openRegularTranscript } from '../../shared/agent-hook-listener/safe-transcript-opener'
import {
  closeTranscriptHandle,
  openTranscriptReadStream,
  wslGatedOpen,
  wslGatedReadFile
} from './wsl-transcript-fs-access'
import { WslTranscriptFsProcessOperations } from './wsl-transcript-fs-process-operations'
import { readLocalLogTailRange } from '../ai-vault/local-log-tail-reader'
import { createRelayAiVaultFilesystemProvider } from '../../relay/ai-vault-service-filesystem'
import { readRelayTranscriptBytes } from '../../relay/ai-vault-transcript-stream'

const fixtureRoot = resolve('logs/upstream-sync/re-review/transcript-security')
const roots: string[] = []
function fixture() {
  mkdirSync(fixtureRoot, { recursive: true })
  const root = mkdtempSync(join(fixtureRoot, 'case-'))
  roots.push(root)
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (dirname(root) !== fixtureRoot || !basename(root).startsWith('case-')) {
      throw new Error('Unsafe fixture cleanup path')
    }
    rmSync(root, { recursive: true, force: true })
  }
})

const readers = {
  localTail: (path: string) => readLocalLogTailRange(path, 0),
  relayFile: (path: string) => createRelayAiVaultFilesystemProvider().readFile(path),
  relayStream: async (path: string) => {
    let text = ''
    for await (const chunk of readRelayTranscriptBytes(path)) {
      text += chunk.toString('utf8')
    }
    return text
  },
  hook: async (path: string) => {
    const opened = openRegularTranscript(path)
    if (!opened) {
      throw new Error('refused')
    }
    closeSync(opened.fd)
  },
  localHandle: async (path: string) => {
    const handle = await wslGatedOpen(path, 'exact')
    await closeTranscriptHandle(handle, path)
  },
  localFile: (path: string) => wslGatedReadFile(path, 'utf8', 'scan'),
  localStream: async (path: string) => {
    let text = ''
    for await (const chunk of openTranscriptReadStream(path, { encoding: 'utf8' }, 'scan')) {
      text += chunk
    }
    return text
  },
  processFile: (path: string) =>
    new WslTranscriptFsProcessOperations().execute({
      id: 1,
      operation: 'readfile',
      path,
      encoding: 'utf8'
    }),
  processHandle: async (path: string) => {
    const owner = new WslTranscriptFsProcessOperations()
    const handleId = (await owner.execute({ id: 1, operation: 'open', path })) as number
    await owner.execute({ id: 2, operation: 'close', handleId })
  }
}

describe.each(Object.entries(readers))('transcript boundary: %s', (_name, read) => {
  it('accepts a regular transcript', async () => {
    const path = join(fixture(), 'session.jsonl')
    await writeFile(path, 'transcript')
    await read(path)
  })

  it('rejects a hardlink to unrelated content', async () => {
    const root = fixture()
    const secret = join(root, 'secret')
    const transcript = join(root, 'session.jsonl')
    await writeFile(secret, 'sensitive-content')
    await link(secret, transcript)
    await expect(read(transcript)).rejects.toThrow()
  })

  it('rejects a directory without reading it', async () => {
    await expect(read(fixture())).rejects.toThrow()
  })

  it('rejects a symlink to unrelated content', async (context) => {
    const root = fixture()
    const secret = join(root, 'secret')
    const transcript = join(root, 'session.jsonl')
    await writeFile(secret, 'sensitive-content')
    try {
      await symlink(secret, transcript, 'file')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') {
        return context.skip()
      }
      throw error
    }
    await expect(read(transcript)).rejects.toThrow()
  })
})
