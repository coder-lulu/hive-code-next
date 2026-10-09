import type * as childProcess from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginMarketplaceGitSource } from '../../shared/plugins/plugin-marketplace'
import { runProcess } from '../../shared/child-process/run-process'
import { getUserPluginsDir } from './plugin-discovery'
import { readPluginLockfile } from './plugin-install'
import { PluginMarketplaceInstaller } from './plugin-marketplace-installer'
import { PluginMarketplaceService } from './plugin-marketplace-service'

const children = vi.hoisted<{ closed: Promise<void>[] }>(() => ({ closed: [] }))

vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof childProcess>()
  function trackChild(child: childProcess.ChildProcess): void {
    const closed = Promise.withResolvers<void>()
    children.closed.push(closed.promise)
    child.once('close', () => closed.resolve())
    child.once('error', () => {
      if (!child.pid) {
        closed.resolve()
      }
    })
  }
  const execFile = new Proxy(real.execFile, {
    apply(target, receiver, args: Parameters<typeof real.execFile>) {
      const child = target.apply(receiver, args)
      trackChild(child)
      return child
    }
  })
  const spawn = new Proxy(real.spawn, {
    apply(target, receiver, args: Parameters<typeof real.spawn>) {
      const child = target.apply(receiver, args)
      trackChild(child)
      return child
    }
  })
  return { ...real, execFile, spawn }
})

const temporaryRoots: string[] = []
const fixtureTerminations: Promise<void>[] = []
const pluginKey = 'private.private-locale'
const pluginUrl = 'ssh://git@example.invalid/private/locale.git'
const marketplaceUrl = 'ssh://git@example.invalid/private/marketplace.git'
let userDataPath: string
let setupSignal: AbortSignal
let pendingSetup: Promise<void> | undefined
let pendingSubject: Promise<void> | undefined
const savedEnvironment = {
  GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND,
  GIT_SSH_VARIANT: process.env.GIT_SSH_VARIANT,
  ORCA_TEST_SSH_REPOSITORIES: process.env.ORCA_TEST_SSH_REPOSITORIES
}

async function runGit(cwd: string, args: string[]): Promise<void> {
  setupSignal.throwIfAborted()
  const terminated = Promise.withResolvers<void>()
  fixtureTerminations.push(terminated.promise)
  const result = await runProcess({
    program: 'git',
    args,
    cwd,
    signal: setupSignal,
    timeoutMs: null,
    terminationBarrier: true,
    onChildTerminated: terminated.resolve
  })
  setupSignal.throwIfAborted()
  if (result.code !== 0 || result.signal !== null || result.timedOut) {
    throw new Error(`Git fixture command failed: ${args.join(' ')}\n${result.stderr}`)
  }
}

async function createGitRepository(
  root: string,
  name: string,
  files: Record<string, string>
): Promise<string> {
  const repository = join(root, name)
  await mkdir(repository, { recursive: true })
  for (const [relativePath, contents] of Object.entries(files)) {
    const path = join(repository, relativePath)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, contents, 'utf8')
  }
  await runGit(repository, ['init', '--quiet'])
  await runGit(repository, ['checkout', '--quiet', '-b', 'main'])
  await runGit(repository, ['add', '--all'])
  await runGit(repository, [
    '-c',
    'user.name=Orca Test',
    '-c',
    'user.email=orca-test@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'fixture'
  ])
  return repository
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

afterEach(async () => {
  await Promise.allSettled([
    ...(pendingSetup ? [pendingSetup] : []),
    ...(pendingSubject ? [pendingSubject] : [])
  ])
  await Promise.all(fixtureTerminations.splice(0))
  await Promise.all(children.closed.splice(0))
  pendingSetup = undefined
  pendingSubject = undefined
  for (const [key, value] of Object.entries(savedEnvironment)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
})

describe('private Git marketplace integration', () => {
  beforeEach(async ({ signal }) => {
    setupSignal = signal
    pendingSetup = prepareMarketplaceFixture()
    await pendingSetup
  })

  async function prepareMarketplaceFixture(): Promise<void> {
    const root = await mkdtemp(join(tmpdir(), 'orca-private-marketplace-'))
    temporaryRoots.push(root)
    const pluginRepository = await createGitRepository(root, 'locale-source', {
      'orca-plugin.json': JSON.stringify({
        manifestVersion: 1,
        id: 'private-locale',
        publisher: 'private',
        name: 'Private Locale',
        version: '1.0.0',
        engines: { orca: '>=1.4.0' },
        pluginApi: 1,
        contributes: {
          languagePacks: [{ locale: 'pt-BR', path: 'locale.json' }]
        },
        capabilities: []
      }),
      'locale.json': JSON.stringify({
        settings: { title: 'Ajustes' }
      })
    })
    const marketplaceRepository = await createGitRepository(root, 'marketplace-source', {
      'orca-marketplace.json': JSON.stringify({
        name: 'Private Team Plugins',
        owner: 'private-team',
        plugins: [
          {
            id: pluginKey,
            source: { kind: 'git', url: pluginUrl, ref: 'main' },
            categories: ['languages']
          }
        ]
      })
    })
    const sshShim = join(root, 'git-ssh-shim.cjs')
    await writeFile(
      sshShim,
      await readFile(join(import.meta.dirname, 'plugin-private-marketplace-ssh-shim.cjs'), 'utf8'),
      'utf8'
    )
    process.env.GIT_SSH_COMMAND = `${shellQuote(process.execPath.replaceAll('\\', '/'))} ${shellQuote(sshShim.replaceAll('\\', '/'))}`
    process.env.GIT_SSH_VARIANT = 'ssh'
    process.env.ORCA_TEST_SSH_REPOSITORIES = JSON.stringify({
      '/private/locale.git': pluginRepository,
      '/private/marketplace.git': marketplaceRepository
    })

    userDataPath = join(root, 'user-data')
  }

  it('uses the caller SSH environment for marketplace preview and install', async () => {
    pendingSubject = exercisePrivateMarketplace()
    await pendingSubject
  })

  async function exercisePrivateMarketplace(): Promise<void> {
    const marketplace = new PluginMarketplaceService({
      pluginsDataDir: join(userDataPath, 'plugins-data')
    })
    const source: PluginMarketplaceGitSource = {
      kind: 'git',
      url: marketplaceUrl,
      ref: 'main'
    }
    const registered = await marketplace.addSource(source)
    const installer = new PluginMarketplaceInstaller({
      marketplace,
      userDataPath,
      hostVersion: '1.4.0'
    })

    const preview = await installer.preview(registered.id, pluginKey)
    const installed = await installer.install(preview)

    expect(registered).toMatchObject({
      stale: false,
      marketplace: { name: 'Private Team Plugins' }
    })
    expect(preview).toMatchObject({ pluginKey, official: false, source: { url: pluginUrl } })
    expect(installed).toMatchObject({ ok: true, pluginKey })
    const lock = await readPluginLockfile(getUserPluginsDir(userDataPath))
    expect(lock.plugins[pluginKey]?.source).toMatchObject({
      kind: 'marketplace',
      marketplace: { url: marketplaceUrl },
      plugin: { url: pluginUrl }
    })
  }
})
