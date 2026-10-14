import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { once } from 'node:events'
import { build } from 'esbuild'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { spawnProcess } from '@orca/process-host'
import { WSL_BROWSER_NETWORK_RELAY_SENTINEL } from '../shared/wsl-browser-network-relay-contract'
let root: string
let entry: string
beforeAll(async () => {
  const base = resolve('logs/wsl-browser-entry')
  await mkdir(base, { recursive: true })
  root = await mkdtemp(join(base, 'case-'))
  entry = join(root, 'relay.cjs')
  await build({
    entryPoints: [resolve('src/wsl-guest/wsl-browser-network-relay.ts')],
    outfile: entry,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent'
  })
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})
it.each(['eof', 'malformed-frame'])('real entry drains and exits on %s', async (action) => {
  const child = spawnProcess({ program: process.execPath, args: [entry], stdio: 'pipe' })
  const closed = once(child, 'close')
  let timer: ReturnType<typeof setTimeout> | undefined
  let stderr = ''
  try {
    await new Promise<void>((resolveReady, reject) => {
      child.once('error', reject)
      child.stderr!.on('data', (bytes) => {
        stderr += bytes.toString()
        if (stderr.includes(WSL_BROWSER_NETWORK_RELAY_SENTINEL)) {
          resolveReady()
        }
      })
    })
    if (action === 'eof') {
      child.stdin!.end()
    } else {
      child.stdin!.write(Buffer.from([0, 0, 0, 0]))
    }
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('relay did not release stdin after shutdown')),
        3000
      )
    })
    expect(await Promise.race([closed, deadline])).toEqual([0, null])
    expect(stderr).toBe(WSL_BROWSER_NETWORK_RELAY_SENTINEL)
  } finally {
    clearTimeout(timer)
    if (child.exitCode === null && child.signalCode === null) {
      child.kill()
      await closed
    }
  }
})
