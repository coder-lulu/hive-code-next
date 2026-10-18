import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, mkdir, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { run, parseArgs, SCRIPT_URL, runBash } from '../lib/installer.mjs'

const tempRoot = fileURLToPath(new URL('../../../logs/npm-installer/tmp/', import.meta.url))
await mkdir(tempRoot, { recursive: true })
const script = '#!/usr/bin/env bash\nexit 0\n'
const response = () => new Response(script)

test('parses only supported options, defaults to auto and beta', () => {
  assert.deepEqual(parseArgs([]), { method: 'auto', channel: 'beta', help: false })
  assert.deepEqual(parseArgs(['--headless', '--method', 'standalone', '--channel', 'stable']), {
    method: 'standalone',
    channel: 'stable',
    help: false
  })
  for (const args of [
    ['--method'],
    ['--channel', 'latest'],
    ['--url', 'https://example.org'],
    ['--method', 'npm']
  ]) {
    assert.throws(() => parseArgs(args))
  }
})

test('help, invalid arguments and unsupported OS perform no fetch or execution', async () => {
  const fetch = () => assert.fail('network must not run')
  assert.equal(await run(['--help'], { fetch, platform: 'win32', print: () => {} }), 0)
  await assert.rejects(run([], { fetch, platform: 'win32' }), /requires Linux/)
  await assert.rejects(run(['--bad'], { fetch, platform: 'linux' }), /Unknown argument/)
})

test('downloads fully before executing, forwards arguments and exit status, removes private temporary file', async () => {
  let savedPath
  const code = await run(['--method', 'standalone', '--channel', 'stable'], {
    platform: 'linux',
    tempRoot,
    fetch: async (url, options) => {
      assert.equal(url, SCRIPT_URL)
      assert.equal(options.redirect, 'error')
      return response()
    },
    execute: async (path, args) => {
      savedPath = path
      assert.equal(await readFile(path, 'utf8'), script)
      if (process.platform !== 'win32') {
        assert.equal((await stat(path)).mode & 0o777, 0o600)
      }
      assert.deepEqual(args, ['--method', 'standalone', '--channel', 'stable'])
      return 17
    }
  })
  assert.equal(code, 17)
  await assert.rejects(stat(savedPath), { code: 'ENOENT' })
})

test('rejects HTTP errors, redirects, oversized, empty or HTML downloads without executing', async () => {
  for (const fetch of [
    async () => new Response('not found', { status: 404 }),
    async () =>
      new Response('', { status: 302, headers: { location: 'https://example.org/install.sh' } }),
    async () => new Response(script, { headers: { 'content-length': '1048577' } }),
    async () => new Response('x'.repeat(1048577)),
    async () => new Response(''),
    async () => new Response('<!DOCTYPE html>'),
    async () => {
      throw new Error('private network information')
    },
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(script))
            controller.error(new Error('truncated'))
          }
        })
      )
  ]) {
    await assert.rejects(
      run([], {
        platform: 'linux',
        tempRoot,
        fetch,
        execute: () => assert.fail('must not execute')
      }),
      /Unable to download a valid official installer/
    )
  }
})

test('bounded download timeout prevents execution', async () => {
  await assert.rejects(
    run([], {
      platform: 'linux',
      tempRoot,
      timeoutMs: 5,
      fetch: (_url, { signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        ),
      execute: () => assert.fail('must not execute')
    }),
    /timed out or was interrupted/
  )
})

test('interruption returns conventional status and removes listeners', async () => {
  const listeners = process.listenerCount('SIGINT')
  const code = await run([], {
    platform: 'linux',
    tempRoot,
    fetch: async () => {
      process.emit('SIGINT')
      return response()
    },
    execute: () => assert.fail('must not execute')
  })
  assert.equal(code, 130)
  assert.equal(process.listenerCount('SIGINT'), listeners)
})

test('execution failure still cleans up the script', async () => {
  let savedPath
  await assert.rejects(
    run([], {
      platform: 'linux',
      tempRoot,
      fetch: response,
      execute: async (path) => {
        savedPath = path
        throw new Error('failed')
      }
    }),
    /failed/
  )
  await assert.rejects(stat(savedPath), { code: 'ENOENT' })
})

test(
  'Bash passes through real fixture exit status on Linux',
  { skip: process.platform !== 'linux' },
  async () => {
    const code = await run([], {
      platform: 'linux',
      tempRoot,
      fetch: () => new Response('#!/usr/bin/env bash\nexit 23\n')
    })
    assert.equal(code, 23)
  }
)

test('Bash startup failure is explicit', async () => {
  const { EventEmitter } = await import('node:events')
  await assert.rejects(
    runBash('unused', [], new AbortController().signal, () => {
      const child = new EventEmitter()
      queueMicrotask(() => child.emit('error', new Error('ENOENT')))
      return child
    }),
    /Unable to start Bash/
  )
})

test(
  'interrupted real Bash returns 143 and cleans up',
  { skip: process.platform !== 'linux' },
  async () => {
    const code = await run([], {
      platform: 'linux',
      tempRoot,
      fetch: () => new Response('#!/usr/bin/env bash\nsleep 30\n'),
      execute: (path, args, signal) => {
        const timer = setTimeout(() => process.emit('SIGTERM'), 100)
        return runBash(path, args, signal).finally(() => clearTimeout(timer))
      }
    })
    assert.equal(code, 143)
  }
)

test(
  'Bash retains the controlling terminal for password prompts',
  { skip: process.platform !== 'linux' },
  () => {
    const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`
    const fixture = fileURLToPath(new URL('./fixtures/tty-install.mjs', import.meta.url))
    const output = execFileSync(
      'script',
      ['-q', '-e', '-c', `${quote(process.execPath)} ${quote(fixture)}`, '/dev/null'],
      { encoding: 'utf8', timeout: 10000 }
    )
    assert.match(output, /TTY_AVAILABLE/)
  }
)

test('all temporary installer directories were removed', async () => {
  assert.deepEqual(await readdir(tempRoot), [])
})
