import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { once } from 'node:events'
import { afterEach, expect, it } from 'vitest'
import { forkProcess } from './fork-process'
import type { SpawnedProcess } from './process-spec'
const children: SpawnedProcess[] = []
const roots: string[] = []
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'close')
      child.kill()
      await closed
    }
  }
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})
it.each([false, true])(
  'forks a real IPC child with explicit execPath=%s and caller cwd/env/argv',
  async (explicit) => {
    const base = resolve('logs/process-host-fork')
    await mkdir(base, { recursive: true })
    const root = await mkdtemp(join(base, 'case-'))
    roots.push(root)
    const entry = join(root, 'child.cjs')
    await writeFile(
      entry,
      "process.send({cwd:process.cwd(),args:process.argv.slice(2),value:process.env.HIVE_FORK_FIXTURE});process.on('message',m=>{if(m==='finish'){process.disconnect();process.exitCode=7}})"
    )
    const child = forkProcess({
      modulePath: entry,
      args: ['space argument', 'literal&value'],
      cwd: root,
      env: { ...process.env, HIVE_FORK_FIXTURE: 'owned-child' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      ...(explicit ? { execPath: process.execPath } : {})
    })
    children.push(child)
    const closed = once(child, 'close')
    const [message] = await once(child, 'message')
    expect(message).toEqual({
      cwd: root,
      args: ['space argument', 'literal&value'],
      value: 'owned-child'
    })
    child.send('finish')
    expect(await closed).toEqual([7, null])
  }
)
