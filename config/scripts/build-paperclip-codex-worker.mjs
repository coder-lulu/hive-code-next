import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { obtainCodexPackage } from './paperclip-codex-package.mjs'

const root = resolve(import.meta.dirname, '../..')
const output = join(root, 'out/paperclip-runtime')
const evidence = join(root, 'logs/paperclip-runtime-build')
await mkdir(output, { recursive: true })
await mkdir(evidence, { recursive: true })
const pin = JSON.parse(
  await readFile(join(root, 'integration/paperclip/runtime/codex-package.json'), 'utf8')
)
const catalog = JSON.parse(
  await readFile(join(root, 'integration/paperclip/runtime/hive-models.json'), 'utf8')
)
const modelProvenance = JSON.parse(
  await readFile(join(root, 'integration/paperclip/runtime/catalog-provenance.json'), 'utf8')
)
const catalogSha256 = createHash('sha256').update(JSON.stringify(catalog)).digest('hex')
assert.equal(modelProvenance.codexVersion, pin.version)
assert.equal(modelProvenance.catalogSha256, catalogSha256)
assert.equal(catalog.models.length, 1)
assert.equal(catalog.models[0].slug, modelProvenance.model)
assert.equal(catalog.models[0].use_responses_lite, true)
assert.equal(catalog.models[0].tool_mode, 'code_mode_only')
const inventory = JSON.parse(
  await readFile(join(root, 'integration/paperclip/runtime/model-tools.json'), 'utf8')
)
assert.equal(inventory.codexVersion, pin.version)
assert.equal(inventory.packageSha256, pin.sha256)
assert.equal(inventory.binarySha256, pin.binarySha256)
assert.equal(inventory.model, modelProvenance.model)
assert.equal(inventory.catalogSha256, catalogSha256)
assert.equal(inventory.configurationSerialization, 'utf8 CRLF normalized to LF')
assert.equal(
  inventory.toolsSha256,
  createHash('sha256').update(JSON.stringify(inventory.tools)).digest('hex')
)
for (const [name, digest] of [
  ['config.toml', inventory.configSha256],
  ['requirements.toml', inventory.requirementsSha256]
]) {
  const text = await readFile(join(root, 'integration/paperclip/runtime', name), 'utf8')
  assert.equal(createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex'), digest)
}
const archive = join(evidence, `codex-package-${pin.version}.tar.gz`)
const asset = await obtainCodexPackage(pin, archive)
const compiled = await build({
  entryPoints: [join(root, 'integration/paperclip/runtime/codex-worker.ts')],
  outfile: join(output, 'codex-worker.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  metafile: true,
  legalComments: 'eof',
  logLevel: 'silent',
  banner: {
    js: "import { createRequire as createBundleRequire } from 'node:module'; const require = createBundleRequire(import.meta.url);"
  }
})
for (const input of Object.keys(compiled.metafile.inputs)) {
  if (/node_modules|codex-accounts|hive-account|native-pi|managed-pi/.test(input)) {
    throw new Error('Host accounts and agent dependencies must not enter the Docker worker')
  }
}
await copyFile(archive, join(output, 'codex-package.tar.gz'))
for (const name of [
  'Dockerfile',
  'config.toml',
  'requirements.toml',
  'hive-models.json',
  'codex-LICENSE',
  'codex-NOTICE'
]) {
  await copyFile(join(root, 'integration/paperclip/runtime', name), join(output, name))
}
const worker = await readFile(join(output, 'codex-worker.mjs'))
await writeFile(
  join(evidence, 'worker-build.json'),
  JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      codexVersion: pin.version,
      model: modelProvenance.model,
      catalogSha256,
      toolsSha256: inventory.toolsSha256,
      asset,
      workerSha256: createHash('sha256').update(worker).digest('hex'),
      workerBytes: worker.byteLength,
      inputs: Object.keys(compiled.metafile.inputs),
      providerCredentialsBundled: false,
      actualTeamExecutionQualified: false
    },
    null,
    2
  )
)
console.log('Built the pinned credential-free Codex Docker context at out/paperclip-runtime')
