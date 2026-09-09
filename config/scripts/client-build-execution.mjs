import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync
} from 'node:fs'
import { join } from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier.startsWith('.') &&
      !/\.[cm]?[jt]s$/.test(specifier) &&
      context.parentURL?.includes('/src/shared/child-process/')
    ) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL)
      if (existsSync(fileURLToPath(candidate))) {
        return { url: candidate.href, shortCircuit: true }
      }
    }
    return nextResolve(specifier, context)
  }
})
const { spawnProcess, runProcess } = await import('../../src/shared/child-process/run-process.ts')
loader.deregister()

export async function capture(context, program, args, cwd = context.root) {
  const result = await runProcess({ program, args, cwd, env: context.env, timeoutMs: 60_000 })
  if (result.code !== 0) {
    throw new Error(`${program} failed: ${result.stderr || result.stdout}`)
  }
  if (result.outputTruncated) {
    throw new Error(`${program} output exceeded the evidence limit`)
  }
  return `${result.stdout}${result.stderr}`.trim()
}

export async function step(context, label, program, args, cwd = context.root) {
  mkdirSync(context.logs, { recursive: true })
  console.log(`[clients] ${label}`)
  const log = createWriteStream(join(context.logs, `${label}.log`))
  try {
    const child = spawnProcess({ program, args, cwd, env: context.env })
    child.stdin.end()
    child.stdout.on('data', (chunk) => log.write(chunk))
    child.stderr.on('data', (chunk) => log.write(chunk))
    await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code, signal) =>
        code === 0
          ? resolve()
          : reject(
              new Error(
                `${label} failed (${code ?? signal}); see ${join(context.logs, `${label}.log`)}`
              )
            )
      )
    })
  } finally {
    await new Promise((resolve) => log.end(resolve))
  }
}

export function acquireBuildLock(root) {
  const file = join(root, '.client-build.lock')
  const token = `${process.pid}:${Date.now()}`
  try {
    writeFileSync(file, token, { flag: 'wx' })
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(
        `Another client build owns ${file}; verify its process has exited before removing a stale lock`
      )
    }
    throw error
  }
  return () => {
    if (readFileSync(file, 'utf8') === token) {
      unlinkSync(file)
    }
  }
}

export function pnpmStep(context, label, args, cwd = context.root) {
  const command = pnpmCommand(args)
  return step(context, label, command.program, command.args, cwd)
}

export function pnpmCommand(args) {
  const executable = process.env.npm_execpath
  if (!executable) {
    throw new Error('Run this entry through pnpm run clients:doctor|prepare|build')
  }
  return /\.[cm]?js$/.test(executable)
    ? { program: process.execPath, args: [executable, ...args] }
    : { program: executable, args }
}

export function nodeStep(context, label, script, args = [], cwd = context.root) {
  return step(context, label, process.execPath, [script, ...args], cwd)
}
