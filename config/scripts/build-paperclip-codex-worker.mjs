import { build } from 'esbuild'
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
for (const name of ['Dockerfile', 'config.toml', 'requirements.toml']) {
  await copyFile(join(root, 'integration/paperclip/runtime', name), join(output, name))
}
const worker = await readFile(join(output, 'codex-worker.mjs'))
await writeFile(
  join(evidence, 'worker-build.json'),
  JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      codexVersion: pin.version,
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
