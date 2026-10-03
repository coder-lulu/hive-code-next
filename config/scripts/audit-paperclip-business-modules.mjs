import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { paperclipDatabaseSourceDigest } from './paperclip-source-proof.mjs'

const args = process.argv.slice(2)
if (args.length !== 2 || !/^[0-9a-f]{40}$/.test(args[1])) {
  throw new Error(
    'Usage: node config/scripts/audit-paperclip-business-modules.mjs <candidate-source> <candidate-revision>'
  )
}
const root = resolve(import.meta.dirname, '../..')
const manifest = JSON.parse(
  await readFile(join(root, 'integration/paperclip/compatibility-manifest.json'), 'utf8')
)
const pinned = resolve(
  process.env.HIVE_PAPERCLIP_SOURCE ?? join(root, 'logs/paperclip-p1/paperclip')
)
const candidate = resolve(args[0])
async function requireRevision(source, expected) {
  const head = (await readFile(join(source, '.git/HEAD'), 'utf8')).trim()
  const revision = head.startsWith('ref: ')
    ? (await readFile(join(source, '.git', head.slice(5)), 'utf8')).trim()
    : head
  assert.equal(revision, expected, 'Audit checkout differs from the requested revision')
}
await requireRevision(pinned, manifest.paperclip.revision)
await requireRevision(candidate, args[1])
assert.equal(await paperclipDatabaseSourceDigest(pinned), manifest.paperclip.databaseSourceDigest)
const evidenceRoot = join(root, 'logs/paperclip-prerequisites')
await mkdir(evidenceRoot, { recursive: true })
const directory = await mkdtemp(join(evidenceRoot, 'module-audit-'))
const digest = (value) => createHash('sha256').update(value.replaceAll('\r\n', '\n')).digest('hex')

async function inspectMigrations(source) {
  const path = join(source, 'packages/db/src/migrations')
  const journal = JSON.parse(await readFile(join(path, 'meta/_journal.json'), 'utf8'))
  const entries = []
  for (const entry of journal.entries) {
    const sql = await readFile(join(path, `${entry.tag}.sql`), 'utf8')
    entries.push({
      ...entry,
      sha256: digest(sql),
      rawSha256: createHash('sha256').update(sql).digest('hex')
    })
  }
  return entries
}
const baselineMigrations = await inspectMigrations(pinned)
const candidateMigrations = await inspectMigrations(candidate)
const unchangedMigrationPrefix = baselineMigrations.every((entry, index) => {
  const next = candidateMigrations[index]
  return (
    next &&
    entry.idx === next.idx &&
    entry.tag === next.tag &&
    entry.sha256 === next.sha256 &&
    entry.when === next.when &&
    entry.version === next.version &&
    entry.breakpoints === next.breakpoints
  )
})
const baselineTags = new Set(baselineMigrations.map((entry) => entry.tag))
const rawChecksumMismatchCount = baselineMigrations.filter(
  (entry, index) => entry.rawSha256 !== candidateMigrations[index]?.rawSha256
).length
const addedMigrations = candidateMigrations
  .filter((entry) => !baselineTags.has(entry.tag))
  .map((entry) => entry.tag)
const requireDb = createRequire(join(pinned, 'packages/db/package.json'))
const requireRoot = createRequire(join(root, 'package.json'))

async function inspectSchema(source, name) {
  const path = (suffix) => JSON.stringify(join(source, suffix).replaceAll('\\', '/'))
  const file = join(directory, `${name}.mjs`)
  const result = await build({
    stdin: {
      contents: `export * from ${path('packages/db/src/schema/index.ts')};\nexport * as validators from ${path('packages/shared/src/validators/pipeline.ts')};`,
      resolveDir: root,
      sourcefile: 'paperclip-business-schema.ts'
    },
    outfile: file,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    metafile: true,
    alias: {
      'drizzle-orm/pg-core': requireDb.resolve('drizzle-orm/pg-core'),
      'drizzle-orm': requireDb.resolve('drizzle-orm'),
      zod: requireRoot.resolve('zod')
    },
    logLevel: 'silent',
    legalComments: 'eof'
  })
  const inputs = Object.keys(result.metafile.inputs)
  const forbidden = inputs.filter((input) =>
    /(?:\/server\/src\/|adapter-(?:claude|codex|cursor|gemini|grok)|(?:native|managed)-pi|pi-coding-agent)/.test(
      input
    )
  )
  assert.deepEqual(forbidden, [], 'Execution code entered the business schema PoC')
  const exported = await import(pathToFileURL(file).href)
  const tables = ['companies', 'projects', 'agents', 'issues', 'pipelines', 'pipelineCases']
  for (const table of tables) {
    assert.ok(exported[table], `Missing business table ${table}`)
  }
  const acceptsUnsafeAutomationFields = exported.validators.pipelineStageAutomationSchema.safeParse(
    { command: 'untrusted-field', env: { PRIVATE_VALUE: 'untrusted-field' } }
  )
  assert.equal(acceptsUnsafeAutomationFields.success, true)
  assert.equal(acceptsUnsafeAutomationFields.data.command, 'untrusted-field')
  const passthroughConfig = exported.validators.pipelineStageConfigSchema.safeParse({
    transcript: 'private-context-field'
  })
  assert.equal(passthroughConfig.success, true)
  assert.equal(passthroughConfig.data.transcript, 'private-context-field')
  const facts = {
    tables,
    pipelineEnforceTransitionsDefault: exported.pipelines.enforceTransitions.default,
    pipelineHasDefinitionRevision: Boolean(
      exported.pipelines.workflowRevision || exported.pipelines.definitionRevision
    ),
    caseHasOptimisticVersion: Boolean(exported.pipelineCases.version),
    automationRetainsUnknownFields: true,
    stageConfigRetainsUnknownFields: true,
    providerOrServerInputs: forbidden,
    bundledInputCount: inputs.length,
    bundleBytes: (await readFile(file)).byteLength,
    schemaSourceDigest: await paperclipDatabaseSourceDigest(source)
  }
  await writeFile(
    join(directory, `${name}-build-inputs.json`),
    `${JSON.stringify(inputs, null, 2)}\n`
  )
  return facts
}
const baseline = await inspectSchema(pinned, 'pinned')
const next = await inspectSchema(candidate, 'candidate')
const auditPaths = [
  'packages/db/src/schema/pipelines.ts',
  'packages/db/src/schema/pipeline_cases.ts',
  'packages/shared/src/validators/pipeline.ts',
  'server/src/adapters/registry.ts',
  'server/src/services/heartbeat.ts'
]
const sourceComparisons = []
for (const path of auditPaths) {
  const before = digest(await readFile(join(pinned, path), 'utf8'))
  const after = digest(await readFile(join(candidate, path), 'utf8'))
  sourceComparisons.push({
    path,
    pinnedSha256: before,
    candidateSha256: after,
    changed: before !== after
  })
}
const receipt = {
  auditKind: 'read_only_business_module_poc',
  pinnedRevision: manifest.paperclip.revision,
  candidateRevision: args[1],
  baseline,
  candidate: next,
  migrations: {
    baselineCount: baselineMigrations.length,
    candidateCount: candidateMigrations.length,
    unchangedMigrationPrefix,
    rawChecksumMismatchCount,
    addedMigrations,
    databaseMigrationExecuted: false
  },
  sourceComparisons,
  readiness: {
    schemaModulePocPassed: true,
    upstreamServerLoaded: false,
    productionRevisionChanged: false,
    candidateServiceIntegrationVerified: false,
    teamExecutionSupported: false,
    requiredBeforeEnablement: [
      'Hive actor/object authorization',
      'hive_runtime-only adapter dispatch',
      'Hive-owned workspace/resource preparation',
      'external execution recovery',
      'immutable workflow/artifact/review bindings',
      'actual host enforcement'
    ]
  }
}
await writeFile(join(directory, 'audit.json'), `${JSON.stringify(receipt, null, 2)}\n`)
await writeFile(join(evidenceRoot, 'upstream-audit.json'), `${JSON.stringify(receipt, null, 2)}\n`)
console.log(
  `Business schema PoC passed for both revisions; Provider/server inputs: 0. Migration prefix unchanged: ${unchangedMigrationPrefix}. Added migrations: ${addedMigrations.length}.`
)
console.log(
  'Current production pin retained; service integration and team enforcement remain unverified.'
)
