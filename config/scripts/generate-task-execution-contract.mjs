import { build } from 'esbuild'
import { mkdir, mkdtemp, open, readFile, rename } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const args = process.argv.slice(2)
if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
  throw new Error('Usage: node config/scripts/generate-task-execution-contract.mjs [--check]')
}
const checkOnly = args[0] === '--check'
const root = resolve(import.meta.dirname, '../..')
const scratchRoot = resolve(root, 'logs/paperclip-p0/tmp')
const destination = resolve(root, 'integration/contracts/v1/task-execution.schema.json')
await mkdir(scratchRoot, { recursive: true })
const scratchDirectory = await mkdtemp(join(scratchRoot, 'task-execution-'))
const scratch = join(scratchDirectory, 'contract.mjs')
await build({
  entryPoints: [resolve(root, 'src/shared/task-execution/task-execution-contract.ts')],
  outfile: scratch,
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  logLevel: 'silent'
})
const { taskExecutionJsonSchema } = await import(pathToFileURL(scratch).href)
const output = `${JSON.stringify(taskExecutionJsonSchema(), null, 2)}\n`
if (checkOnly) {
  if (!isDeepStrictEqual(JSON.parse(await readFile(destination, 'utf8')), JSON.parse(output))) {
    throw new Error('Task execution schema is stale. Run generate-task-execution-contract.mjs.')
  }
  console.log('Task execution schema matches the current TypeScript contract.')
} else {
  await mkdir(dirname(destination), { recursive: true })
  const staged = join(scratchDirectory, 'task-execution.schema.json')
  const file = await open(staged, 'wx')
  try {
    await file.writeFile(output, 'utf8')
    await file.sync()
  } finally {
    await file.close()
  }
  await rename(staged, destination)
  console.log('Generated integration/contracts/v1/task-execution.schema.json')
}
