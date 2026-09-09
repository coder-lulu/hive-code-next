import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { spawnProcess } from '../../src/shared/child-process/run-process'
import { createManagedPiEnvironment } from '../../src/main/runtime/managed-pi-environment'

const fixture = resolve('runtime/managed-pi/fixtures/p0-runner.mjs')

describe('managed Pi P0', () => {
  it('uses an allowlist, not inherited provider/config/PATH values', () => {
    const home = resolve('managed home')
    const env = createManagedPiEnvironment(
      {
        systemroot: 'C:\\Windows',
        OPENAI_API_KEY: 'P0_POISON',
        PI_CODING_AGENT_DIR: 'external',
        PATH: 'external',
        NODE_OPTIONS: '--require=poison',
        ORCA_PI_SOURCE_AGENT_DIR: 'external',
        HTTPS_PROXY: 'external'
      },
      home
    )
    expect(env.SystemRoot).toBe('C:\\Windows')
    expect(env.HOME).toBe(home)
    expect(env.PI_CODING_AGENT_DIR).toBe(join(home, 'agent'))
    expect(env).not.toHaveProperty('OPENAI_API_KEY')
    expect(env).not.toHaveProperty('NODE_OPTIONS')
    expect(env.PATH).toBe(join(home, 'bin'))
    expect(env).not.toHaveProperty('ORCA_PI_SOURCE_AGENT_DIR')
    expect(env).not.toHaveProperty('HTTPS_PROXY')
    expect(() => createManagedPiEnvironment({}, 'relative')).toThrow('absolute')
  })

  it.each(['complete', 'cancel'])('runs real Pi in an owned child: %s', async (mode) => {
    const root = await mkdtemp(join(tmpdir(), 'hive-pi-p0-'))
    const home = join(root, '受管 home')
    const externalHome = join(root, 'external home')
    const project = join(root, 'project')
    const files = [
      join(externalHome, '.pi', 'agent', 'auth.json'),
      join(externalHome, '.pi', 'agent', 'settings.json'),
      join(project, '.pi', 'settings.json'),
      join(project, '.pi', 'extensions', 'poison.mjs'),
      join(project, '.pi', 'skills', 'poison', 'SKILL.md'),
      join(project, 'AGENTS.md')
    ]
    const children: ReturnType<typeof spawnProcess>[] = []
    try {
      for (const dir of ['tmp', 'agent', 'config', 'data', 'cache', 'bin']) {
        await mkdir(join(home, dir), { recursive: true })
      }
      for (const file of files) {
        await mkdir(resolve(file, '..'), { recursive: true })
        await writeFile(
          file,
          file.endsWith('.json')
            ? '{"P0_POISON":"fake credential/config"}'
            : 'throw new Error("P0_POISON")'
        )
      }
      const hashes = () =>
        Promise.all(
          files.map(async (file) =>
            createHash('sha256')
              .update(await readFile(file))
              .digest('hex')
          )
        )
      const before = await hashes()
      const external = spawnProcess({
        program: process.execPath,
        args: [
          '-e',
          'process.stdout.write("ready\\n");process.stdin.resume();process.stdin.on("end",()=>process.exit(0))'
        ],
        cwd: externalHome,
        env: createManagedPiEnvironment(process.env, externalHome)
      })
      children.push(external)
      await once(external.stdout, 'data')
      const env = createManagedPiEnvironment(
        {
          ...process.env,
          HOME: externalHome,
          USERPROFILE: externalHome,
          PI_CODING_AGENT_DIR: join(externalHome, '.pi', 'agent'),
          OPENAI_API_KEY: 'P0_POISON',
          ANTHROPIC_API_KEY: 'P0_POISON',
          AWS_PROFILE: 'P0_POISON',
          NODE_OPTIONS: '--require=nonexistent-poison',
          PATH: project,
          ORCA_PI_SOURCE_AGENT_DIR: externalHome
        },
        home
      )
      const child = spawnProcess({
        program: process.execPath,
        args: [fixture, mode, externalHome, project],
        cwd: home,
        env
      })
      children.push(child)
      let stdout = '',
        stderr = '',
        cancelled = false
      child.stderr.on('data', (data) => {
        stderr += data
      })
      child.stdout.on('data', (data) => {
        stdout += data
        if (mode === 'cancel' && !cancelled && stdout.includes('"delta"')) {
          cancelled = true
          child.stdin.write('cancel\n')
        }
      })
      const closed = once(child, 'close')
      const deadline = setTimeout(() => child.kill(), 20_000)
      let exit: unknown[]
      try {
        exit = await closed
      } finally {
        clearTimeout(deadline)
      }
      expect(stderr).toBe('')
      expect(exit[0]).toBe(0)
      const result = JSON.parse(stdout.trim().split('\n').at(-1)!)
      expect(result.node).toBe(JSON.parse(await readFile('package.json', 'utf8')).engines.node)
      expect(result.pid).toBe(child.pid)
      expect(result.events).toEqual(
        expect.arrayContaining(['agent_start', 'message_update', 'agent_end'])
      )
      expect(result.aborted).toBe(mode === 'cancel')
      expect(result.stopReason).toBe(mode === 'cancel' ? 'aborted' : 'stop')
      expect(result.networkAttempts).toBe(0)
      expect(result.externalReads).toBe(0)
      expect(result.tools).toBe(0)
      expect(stdout + stderr).not.toContain('P0_POISON')
      expect(await hashes()).toEqual(before)
      expect(external.exitCode).toBeNull()
      expect(external.signalCode).toBeNull()
      process.kill(external.pid!, 0)
      process.stdout.write(`P0 ${mode} ${JSON.stringify(result)}\n`)
      const externalClosed = once(external, 'close')
      external.stdin.end()
      await externalClosed
    } finally {
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) {
          const closed = once(child, 'close')
          child.kill()
          await closed
        }
      }
      const owned = relative(resolve(tmpdir()), root)
      if (owned && !owned.startsWith('..') && !isAbsolute(owned)) {
        await rm(root, { recursive: true })
      }
    }
  })
})
