import { copyFile, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runProcess } from '../../src/shared/child-process/run-process'

const expected = { $id: 'urn:hive:task-execution:fixture', type: 'object' }

async function fixture() {
  const directory = resolve('logs/paperclip-p0-review/generator-tests')
  await mkdir(directory, { recursive: true })
  const root = await mkdtemp(join(directory, 'case-'))
  const script = join(root, 'config/scripts/generate-task-execution-contract.mjs')
  const source = join(root, 'src/shared/task-execution/task-execution-contract.ts')
  const destination = join(root, 'integration/contracts/v1/task-execution.schema.json')
  for (const file of [script, source, destination]) {
    await mkdir(dirname(file), { recursive: true })
  }
  await copyFile(resolve('config/scripts/generate-task-execution-contract.mjs'), script)
  await writeFile(
    source,
    `export function taskExecutionJsonSchema() { return ${JSON.stringify(expected)} }`
  )
  await writeFile(destination, `${JSON.stringify(expected, null, 2)}\n`)
  const run = (args: string[] = []) =>
    runProcess({
      program: process.execPath,
      args: [script, ...args],
      cwd: root,
      env: { ...process.env, ORCA_BACKGROUND_LAUNCH: '1' },
      timeoutMs: 20_000
    })
  return { root, source, destination, run }
}

describe('task schema generation', () => {
  it('isolates concurrent checks from previous build artifacts', async () => {
    const { root, run, destination } = await fixture()
    const previous = join(root, 'logs/paperclip-p0/tmp/task-execution-contract.mjs')
    await mkdir(dirname(previous), { recursive: true })
    await writeFile(previous, 'previous diagnostic artifact\n')
    const results = await Promise.all([run(['--check']), run(['--check']), run(['--check'])])
    for (const result of results) {
      expect(result.code, result.stderr).toBe(0)
    }
    expect(await readFile(previous, 'utf8')).toBe('previous diagnostic artifact\n')
    expect(JSON.parse(await readFile(destination, 'utf8'))).toEqual(expected)
  })

  it('leaves the published schema unchanged when generation fails', async () => {
    const { source, destination, run } = await fixture()
    const before = await readFile(destination, 'utf8')
    await writeFile(source, 'export function broken syntax')
    expect((await run()).code).not.toBe(0)
    expect(await readFile(destination, 'utf8')).toBe(before)
  })

  it.each([['--chek'], ['--check', '--unexpected'], ['--check', '--check']])(
    'rejects invalid arguments %j before building or publishing',
    async (...args) => {
      const { root, destination, run } = await fixture()
      await writeFile(destination, '{}\n')
      const before = await stat(destination, { bigint: true })
      const result = await run(args)
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('Usage:')
      expect(await readFile(destination, 'utf8')).toBe('{}\n')
      expect((await stat(destination, { bigint: true })).mtimeNs).toBe(before.mtimeNs)
      await expect(stat(join(root, 'logs/paperclip-p0/tmp'))).rejects.toMatchObject({
        code: 'ENOENT'
      })
    }
  )

  it('publishes complete schemas during concurrent generation and checks', async () => {
    const { destination, run } = await fixture()
    const results = await Promise.all([run(), run(), run(), run(['--check'])])
    for (const result of results) {
      expect(result.code, result.stderr).toBe(0)
    }
    expect(JSON.parse(await readFile(destination, 'utf8'))).toEqual(expected)
  })

  it('publishes a complete schema and checks without rewriting it', async () => {
    const { destination, run } = await fixture()
    await writeFile(destination, '{}\n')
    expect((await run()).code).toBe(0)
    expect(JSON.parse(await readFile(destination, 'utf8'))).toEqual(expected)
    const before = await stat(destination, { bigint: true })
    expect((await run(['--check'])).code).toBe(0)
    expect((await stat(destination, { bigint: true })).mtimeNs).toBe(before.mtimeNs)
  })

  it('checks a reformatted schema without rewriting it', async () => {
    const { destination, run } = await fixture()
    const formatted = `${JSON.stringify(Object.fromEntries(Object.entries(expected).toReversed()))}\r\n`
    await writeFile(destination, formatted)
    const before = await stat(destination, { bigint: true })
    const result = await run(['--check'])
    expect(result.code, result.stderr).toBe(0)
    expect(await readFile(destination, 'utf8')).toBe(formatted)
    expect((await stat(destination, { bigint: true })).mtimeNs).toBe(before.mtimeNs)
  })

  it('refuses a changed schema even when it contains valid JSON', async () => {
    const { destination, run } = await fixture()
    const changed = `${JSON.stringify({ ...expected, type: 'string' })}\n`
    await writeFile(destination, changed)
    const result = await run(['--check'])
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('Task execution schema is stale.')
    expect(await readFile(destination, 'utf8')).toBe(changed)
  })
})
