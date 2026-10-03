import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { paperclipDatabaseSourceDigest } from './paperclip-source-proof.mjs'
import { paperclipServiceNotices } from './paperclip-service-notices.mjs'
import { canonicalizePaperclipMigrationFiles } from '../../integration/paperclip/service/migration-history.mjs'

const root = resolve(import.meta.dirname, '../..')
const source = resolve(
  process.env.HIVE_PAPERCLIP_SOURCE ?? join(root, 'logs/paperclip-p1/paperclip')
)
const output = join(root, 'out/paperclip-service')
const manifest = JSON.parse(
  await readFile(join(root, 'integration/paperclip/compatibility-manifest.json'), 'utf8')
)
const head = (await readFile(join(source, '.git/HEAD'), 'utf8')).trim()
const revision = head.startsWith('ref: ')
  ? (await readFile(join(source, '.git', head.slice(5)), 'utf8')).trim()
  : head
if (revision !== manifest.paperclip.revision) {
  throw new Error('Paperclip source revision does not match the frozen manifest')
}
const sourceDigest = await paperclipDatabaseSourceDigest(source)
if (sourceDigest !== manifest.paperclip.databaseSourceDigest) {
  throw new Error('Paperclip DB/shared sources differ from the audited revision')
}
const requireDb = createRequire(join(source, 'packages/db/package.json'))
await mkdir(output, { recursive: true })
const compiled = await build({
  entryPoints: [join(root, 'integration/paperclip/service/server.mjs')],
  outfile: join(output, 'server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  metafile: true,
  banner: {
    js: "import { createRequire as createBundleRequire } from 'node:module'; const require = createBundleRequire(import.meta.url);"
  },
  alias: {
    '@hive-paperclip-db': join(source, 'packages/db/src/client.ts'),
    '@hive-paperclip-postgres': requireDb.resolve('postgres')
  },
  logLevel: 'silent',
  legalComments: 'eof'
})
const forbidden = Object.keys(compiled.metafile.inputs).filter((file) =>
  /(?:\/server\/src\/|adapter-(?:claude|codex|cursor|gemini|grok)|(?:native|managed)-pi|pi-coding-agent)/.test(
    file
  )
)
if (forbidden.length) {
  throw new Error('Provider or upstream execution code entered the restricted Paperclip service')
}
await cp(join(source, 'packages/db/src/migrations'), join(output, 'migrations'), {
  recursive: true
})
await canonicalizePaperclipMigrationFiles(join(output, 'migrations'))
await copyFile(
  join(root, 'integration/paperclip/service/task-tables.sql'),
  join(output, 'task-tables.sql')
)
await copyFile(join(source, 'LICENSE'), join(output, 'PAPERCLIP-LICENSE'))
await copyFile(join(root, 'LICENSE'), join(output, 'LICENSE'))
await writeFile(
  join(output, 'package.json'),
  JSON.stringify({
    name: '@hivekernel/paperclip-task-service',
    version: '0.1.0',
    type: 'module',
    license: 'MIT',
    engines: { node: '>=24.11.0' }
  })
)
const inputs = Object.keys(compiled.metafile.inputs)
const notices = await paperclipServiceNotices(root, inputs)
await writeFile(join(output, 'THIRD_PARTY_NOTICES.txt'), notices.text)
const bundle = await readFile(join(output, 'server.mjs'))
await mkdir(join(root, 'logs/p1-closeout'), { recursive: true })
await writeFile(
  join(root, 'logs/p1-closeout/service-build.json'),
  JSON.stringify(
    {
      paperclipRevision: revision,
      sourceDigest,
      bundledDependencies: notices.packages,
      adapterAllowlist: ['hive_runtime'],
      providerPackagesBundled: [],
      bundleBytes: bundle.byteLength,
      sha256: createHash('sha256').update(bundle).digest('hex'),
      inputs
    },
    null,
    2
  )
)
console.log('Built restricted Paperclip task service; provider packages bundled: 0')
