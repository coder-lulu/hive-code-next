import type * as childProcess from 'node:child_process'
import { createGitTestRunner } from '../../relay/git-handler-test-setup'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetGiteaRepoRefCache } from '../gitea/repository-ref'
import { getHostedReviewForBranch } from './hosted-review'

const fixtureGit = createGitTestRunner()
const OLD_ENV = process.env

const subjectChildren = vi.hoisted<{ closed: Promise<void>[] }>(() => ({ closed: [] }))

// Track actual close events while preserving the subject's default Git execution path.
vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof childProcess>()
  const execFile = new Proxy(real.execFile, {
    apply(target, receiver, args: Parameters<typeof real.execFile>) {
      const child = target.apply(receiver, args)
      const closed = Promise.withResolvers<void>()
      subjectChildren.closed.push(closed.promise)
      child.once('close', () => closed.resolve())
      child.once('error', () => {
        if (!child.pid) {
          closed.resolve()
        }
      })
      return child
    }
  })
  return { ...real, execFile }
})

type SeenRequest = {
  pathname: string
  search: string
  authorization: string | undefined
}

function sendJson(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

describe('Gitea hosted review integration', () => {
  let repoPath = ''
  let server: ReturnType<typeof createServer> | undefined
  let seen: SeenRequest[]
  let pendingSetup: Promise<void> | undefined
  let pendingSubject: Promise<void> | undefined

  beforeEach(async ({ signal }) => {
    fixtureGit.useSignal(signal, null)
    process.env = { ...OLD_ENV, ORCA_GITEA_TOKEN: 'local-token' }
    delete process.env.ORCA_GITEA_API_BASE_URL
    _resetGiteaRepoRefCache()
    pendingSetup = (async () => {
      seen = []
      const nextServer = createServer((req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
        seen.push({
          pathname: url.pathname,
          search: url.search,
          authorization: req.headers.authorization
        })

        if (url.pathname === '/api/v1/repos/team/repo/pulls') {
          sendJson(res, [
            {
              number: 9,
              title: 'Local Gitea branch',
              state: 'open',
              html_url: 'http://127.0.0.1/team/repo/pulls/9',
              updated_at: '2026-05-15T00:00:00Z',
              mergeable: true,
              head: { ref: 'feature/gitea', label: 'team:feature/gitea', sha: 'abc123' }
            }
          ])
          return
        }

        if (url.pathname === '/api/v1/repos/team/repo/commits/abc123/status') {
          sendJson(res, { state: 'success' })
          return
        }

        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ message: 'not found' }))
      })
      server = nextServer
      await new Promise<void>((resolve) => nextServer.listen(0, '127.0.0.1', resolve))

      repoPath = await mkdtemp(join(tmpdir(), 'orca-gitea-review-'))
      const address = nextServer.address()
      if (!address || typeof address === 'string') {
        throw new Error('expected TCP server address')
      }

      await fixtureGit.git(repoPath, ['init'])
      await fixtureGit.git(repoPath, [
        'remote',
        'add',
        'origin',
        `http://127.0.0.1:${address.port}/team/repo.git`
      ])
    })()
    await pendingSetup
  })

  afterEach(async () => {
    await Promise.allSettled([
      ...(pendingSetup ? [pendingSetup] : []),
      ...(pendingSubject ? [pendingSubject] : [])
    ])
    await fixtureGit.settle()
    await Promise.all(subjectChildren.closed.splice(0))
    if (repoPath) {
      await rm(repoPath, { recursive: true, force: true })
    }
    const ownedServer = server
    if (ownedServer) {
      await new Promise<void>((resolve, reject) =>
        ownedServer.close((error) => (error ? reject(error) : resolve()))
      )
    }
    repoPath = ''
    server = undefined
    pendingSetup = undefined
    pendingSubject = undefined
    process.env = OLD_ENV
    _resetGiteaRepoRefCache()
  })

  it('resolves a Gitea PR through real git remote parsing and HTTP API calls', async () => {
    pendingSubject = (async () => {
      await expect(
        getHostedReviewForBranch({
          executionHostId: 'local',
          repoPath,
          branch: 'refs/heads/feature/gitea'
        })
      ).resolves.toEqual({
        provider: 'gitea',
        number: 9,
        title: 'Local Gitea branch',
        state: 'open',
        url: 'http://127.0.0.1/team/repo/pulls/9',
        status: 'success',
        updatedAt: '2026-05-15T00:00:00Z',
        mergeable: 'MERGEABLE',
        headSha: 'abc123'
      })

      expect(seen.map((request) => request.pathname)).toEqual([
        '/api/v1/repos/team/repo/pulls',
        '/api/v1/repos/team/repo/commits/abc123/status'
      ])
      expect(seen.every((request) => request.authorization === 'token local-token')).toBe(true)
      expect(new URLSearchParams(seen[0].search).get('state')).toBe('all')
    })()
    await pendingSubject
  })
})
