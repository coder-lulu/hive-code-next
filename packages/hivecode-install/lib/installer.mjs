import { mkdtemp, chmod, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

export const SCRIPT_URL = 'https://hivekernel.com/install.sh'
const MAX_BYTES = 1024 * 1024
const HELP = `HiveCode Headless Runtime installer
Usage: npx --yes @hivecode/install [--headless] [--method auto|deb|standalone] [--channel beta|stable]

Requires Linux and Bash. Defaults: --method auto --channel beta.
Downloads the official installer over HTTPS and installs a persistent Runtime.
The Runtime uses its own bundled Node, independently of this bootstrap's Node.
`

export function parseArgs(args) {
  const options = { method: 'auto', channel: 'beta', help: false }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--headless') {
      continue
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg !== '--method' && arg !== '--channel') {
      throw new Error('Unknown argument. Use --help for supported options.')
    }
    const key = arg.slice(2)
    const allowed = key === 'method' ? ['auto', 'deb', 'standalone'] : ['beta', 'stable']
    if (!allowed.includes(args[++i])) {
      throw new Error(`Invalid ${arg}. Allowed values: ${allowed.join(', ')}.`)
    }
    options[key] = args[i]
  }
  return options
}

export async function downloadScript(fetchImpl, signal) {
  let response
  try {
    response = await fetchImpl(SCRIPT_URL, { redirect: 'error', signal })
    if (!response.ok || !response.body) {
      throw new Error('response')
    }
    if (Number(response.headers.get('content-length')) > MAX_BYTES) {
      throw new Error('size')
    }
    const chunks = []
    let size = 0
    for await (const chunk of response.body) {
      signal.throwIfAborted()
      size += chunk.byteLength
      if (size > MAX_BYTES) {
        throw new Error('size')
      }
      chunks.push(Buffer.from(chunk))
    }
    const bytes = Buffer.concat(chunks)
    if (!bytes.toString('utf8').startsWith('#!/usr/bin/env bash\n')) {
      throw new Error('script')
    }
    return bytes
  } catch {
    await response?.body?.cancel().catch(() => {})
    throw new Error(
      signal.aborted
        ? 'Installer download timed out or was interrupted.'
        : 'Unable to download a valid official installer. No script was executed.'
    )
  }
}

export function runBash(script, args, signal, spawnImpl = spawn) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    // Keep the controlling terminal available for sudo's password prompt.
    const detached = !(process.stdin.isTTY || process.stdout.isTTY || process.stderr.isTTY)
    const child = spawnImpl('bash', [script, ...args], {
      stdio: 'inherit',
      detached,
      shell: false
    })
    let timer
    const kill = (name) => {
      if (!child.pid) {
        return
      }
      if (!detached) {
        child.kill(name)
        return
      }
      try {
        process.kill(-child.pid, name)
      } catch (error) {
        if (error.code !== 'ESRCH') {
          child.kill(name)
        }
      }
    }
    const abort = () => {
      kill(signal.reason === 'SIGINT' ? 'SIGINT' : 'SIGTERM')
      timer = setTimeout(() => kill('SIGKILL'), 5000)
      timer.unref()
    }
    const cleanup = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
    }
    signal.addEventListener('abort', abort, { once: true })
    child.once('error', () => {
      cleanup()
      reject(new Error('Unable to start Bash. Install Bash and retry.'))
    })
    child.once('close', (code, childSignal) => {
      cleanup()
      resolve(
        signal.aborted
          ? signal.reason === 'SIGINT'
            ? 130
            : 143
          : (code ?? (childSignal === 'SIGINT' ? 130 : 143))
      )
    })
  })
}

export async function run(args, dependencies = {}) {
  const options = parseArgs(args)
  if (options.help) {
    ;(dependencies.print ?? console.log)(HELP)
    return 0
  }
  if ((dependencies.platform ?? process.platform) !== 'linux') {
    throw new Error('Headless installation currently requires Linux.')
  }
  if (Number(process.versions.node.split('.')[0]) < 18) {
    throw new Error('This installer requires Node.js 18 or newer.')
  }
  const controller = new AbortController()
  const interrupt = (signal) => controller.abort(signal)
  const onInt = () => interrupt('SIGINT')
  const onTerm = () => interrupt('SIGTERM')
  process.on('SIGINT', onInt)
  process.on('SIGTERM', onTerm)
  let directory
  let timeout
  try {
    timeout = setTimeout(() => controller.abort('timeout'), dependencies.timeoutMs ?? 30000)
    const bytes = await downloadScript(dependencies.fetch ?? globalThis.fetch, controller.signal)
    clearTimeout(timeout)
    controller.signal.throwIfAborted()
    directory = await mkdtemp(join(dependencies.tempRoot ?? tmpdir(), 'hivecode-install-'))
    await chmod(directory, 0o700)
    const script = join(directory, 'install.sh')
    await writeFile(script, bytes, { mode: 0o600, flag: 'wx' })
    return await (dependencies.execute ?? runBash)(
      script,
      ['--method', options.method, '--channel', options.channel],
      controller.signal
    )
  } catch (error) {
    if (controller.signal.reason === 'SIGINT') {
      return 130
    }
    if (controller.signal.reason === 'SIGTERM') {
      return 143
    }
    throw error
  } finally {
    clearTimeout(timeout)
    process.removeListener('SIGINT', onInt)
    process.removeListener('SIGTERM', onTerm)
    if (directory) {
      await rm(directory, { recursive: true, force: true })
    }
  }
}
