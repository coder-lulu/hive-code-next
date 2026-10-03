import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const output = join(root, 'out/paperclip-adapter')
const manifest = JSON.parse(
  await readFile(join(root, 'integration/paperclip/compatibility-manifest.json'), 'utf8')
)
await mkdir(join(output, 'dist'), { recursive: true })
const compiled = await build({
  entryPoints: [join(root, 'src/main/tasks/paperclip-runtime-adapter.ts')],
  outfile: join(output, 'dist/server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  metafile: true,
  legalComments: 'eof',
  logLevel: 'silent'
})
const forbidden = Object.keys(compiled.metafile.inputs).filter((file) =>
  /(?:native-pi|managed-pi|node_modules\/(?:acpx|@earendil-works|@anthropic-ai|@openai|@paperclipai\/adapter-(?!utils)))/.test(
    file
  )
)
if (forbidden.length) {
  throw new Error('Provider or agent runtime code must not be bundled into the Paperclip adapter.')
}
await writeFile(
  join(output, 'package.json'),
  `${JSON.stringify(
    {
      name: manifest.hiveRuntimeAdapter.proposedPackage,
      version: '0.1.0',
      type: 'module',
      license: 'MIT',
      engines: { node: '>=24.11.0' },
      files: ['dist', 'LICENSE', 'THIRD_PARTY_NOTICES.txt'],
      main: './dist/server.mjs',
      types: './dist/server.d.ts',
      exports: { '.': { types: './dist/server.d.ts', import: './dist/server.mjs' } },
      peerDependencies: { [manifest.adapterUtils.package]: manifest.adapterUtils.version },
      peerDependenciesMeta: { [manifest.adapterUtils.package]: { optional: true } },
      hiveCompatibility: {
        protocolVersion: manifest.protocolVersion,
        paperclipRevision: manifest.paperclip.revision,
        adapterUtilsVersion: manifest.adapterUtils.version
      }
    },
    null,
    2
  )}\n`
)
await writeFile(
  join(output, 'dist/server.d.ts'),
  "import type { ServerAdapterModule } from '@paperclipai/adapter-utils'\nexport declare function createServerAdapter(): ServerAdapterModule\n"
)
await copyFile(join(root, 'LICENSE'), join(output, 'LICENSE'))
const zodPackage = JSON.parse(await readFile(join(root, 'node_modules/zod/package.json'), 'utf8'))
const zodLicense = await readFile(join(root, 'node_modules/zod/LICENSE'), 'utf8')
await writeFile(
  join(output, 'THIRD_PARTY_NOTICES.txt'),
  `Bundled zod ${zodPackage.version}\n\n${zodLicense}`
)
const bundle = await readFile(join(output, 'dist/server.mjs'))
const evidenceRoot = join(root, 'logs/paperclip-p1')
await mkdir(evidenceRoot, { recursive: true })
await writeFile(
  join(evidenceRoot, 'adapter-build.json'),
  `${JSON.stringify(
    {
      package: manifest.hiveRuntimeAdapter.proposedPackage,
      version: '0.1.0',
      paperclipRevision: manifest.paperclip.revision,
      adapterUtilsVersion: manifest.adapterUtils.version,
      bundleBytes: bundle.byteLength,
      sha256: createHash('sha256').update(bundle).digest('hex'),
      providerPackagesBundled: [],
      inputs: Object.keys(compiled.metafile.inputs)
    },
    null,
    2
  )}\n`
)
console.log(
  `Built ${manifest.hiveRuntimeAdapter.proposedPackage} at out/paperclip-adapter; provider packages bundled: 0.`
)
