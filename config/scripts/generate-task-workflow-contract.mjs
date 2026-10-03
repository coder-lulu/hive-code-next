import { build } from 'esbuild'
import { mkdir, mkdtemp, open, readFile, rename } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const args = process.argv.slice(2)
if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
  throw new Error('Usage: node config/scripts/generate-task-workflow-contract.mjs [--check]')
}
const root = resolve(import.meta.dirname, '../..')
const scratchRoot = resolve(root, 'logs/paperclip-prerequisites/tmp')
const destination = resolve(root, 'integration/contracts/workflow-v1/task-workflow.schema.json')
await mkdir(scratchRoot, { recursive: true })
const scratchDirectory = await mkdtemp(join(scratchRoot, 'workflow-contract-'))
const scratch = join(scratchDirectory, 'contract.mjs')
await build({
  entryPoints: [resolve(root, 'src/shared/task-workflow/workflow-contract.ts')],
  outfile: scratch,
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  logLevel: 'silent'
})
const { taskWorkflowJsonSchema } = await import(pathToFileURL(scratch).href)
const output = `${JSON.stringify(taskWorkflowJsonSchema(), null, 2)}\n`
if (args[0] === '--check') {
  if (!isDeepStrictEqual(JSON.parse(await readFile(destination, 'utf8')), JSON.parse(output))) {
    throw new Error('Workflow schema is stale. Run generate-task-workflow-contract.mjs.')
  }
  console.log('Workflow schema matches the current shared contract.')
} else {
  await mkdir(dirname(destination), { recursive: true })
  const staged = join(scratchDirectory, 'task-workflow.schema.json')
  const file = await open(staged, 'wx')
  try {
    await file.writeFile(output, 'utf8')
    await file.sync()
  } finally {
    await file.close()
  }
  await rename(staged, destination)
  console.log('Generated integration/contracts/workflow-v1/task-workflow.schema.json')
}
