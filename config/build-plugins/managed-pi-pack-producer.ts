import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile
} from 'node:fs/promises'
import { isBuiltin } from 'node:module'
import { isAbsolute, join, resolve } from 'node:path'
import { build, version as esbuildVersion } from 'esbuild'
import productPackage from '../../package.json'
import runtimePackage from '../../runtime/managed-pi/package.json'
import { hiveAgentTextPackManifestSchema } from '../../src/shared/hive-agent-text-pack'
import {
  managedPiPackArtifactNames,
  managedPiPackIndexSchema
} from '../../src/main/runtime/managed-pi-pack-index'
import { loadManagedPiTextPack } from '../../src/main/runtime/managed-pi-pack-loader'
import {
  collectPackBundleNotices,
  packSha256,
  readPackLegalInputs
} from './managed-pi-pack-notices'

const pins = {
  node: productPackage.engines.node,
  pi: runtimePackage.dependencies['@earendil-works/pi-agent-core'],
  commit: runtimePackage.hiveSource.commit
}

/** Build inputs are controlled by the build host; runtime never downloads or installs a Pack. */
export async function produceManagedPiTextPack(projectRoot: string, outputDirectory: string) {
  if (!isAbsolute(projectRoot) || !isAbsolute(outputDirectory)) {
    throw new Error('Pack build paths must be absolute')
  }
  const runtimeRoot = await realpath(join(projectRoot, 'runtime', 'managed-pi'))
  if (
    process.versions.node !== pins.node ||
    runtimePackage.dependencies['@earendil-works/pi-ai'] !== pins.pi
  ) {
    throw new Error('Pack build Node/Pi does not match pins')
  }
  const manifest = hiveAgentTextPackManifestSchema.omit({ packRevision: true }).parse({
    schemaVersion: 1,
    nodeVersion: pins.node,
    piCoreVersion: pins.pi,
    piAiVersion: pins.pi,
    sourceCommit: pins.commit,
    platform: process.platform,
    architecture: process.arch,
    capabilities: ['local.text'],
    protocols: ['CHAT_COMPLETIONS', 'RESPONSES'],
    profiles: [
      {
        profileId: 'personal',
        protocols: ['CHAT_COMPLETIONS', 'RESPONSES'],
        toolPolicy: 'empty',
        maxInputTokens: 16_000,
        maxOutputTokens: 2_000
      }
    ]
  })
  const legal = await readPackLegalInputs(runtimeRoot, pins)
  const lock = await readFile(join(runtimeRoot, 'pnpm-lock.yaml'))
  const result = await build({
    absWorkingDir: runtimeRoot,
    entryPoints: ['agent.mjs'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    outfile: 'agent.cjs',
    write: false,
    metafile: true,
    logLevel: 'silent'
  })
  const metafile = result.metafile!
  for (const output of Object.values(metafile.outputs)) {
    if (output.imports.some((item) => item.external && !isBuiltin(item.path))) {
      throw new Error('Runner has an external non-Node dependency')
    }
  }
  if (result.outputFiles.length !== 1) {
    throw new Error('Runner must be a single self-contained file')
  }
  const bundle = await collectPackBundleNotices(
    runtimeRoot,
    metafile,
    lock.toString('utf8'),
    legal.pi,
    pins.pi
  )
  await mkdir(outputDirectory, { recursive: true })
  if (
    (await lstat(outputDirectory)).isSymbolicLink() ||
    resolve(await realpath(outputDirectory)) !== resolve(outputDirectory)
  ) {
    throw new Error('Pack output root must be canonical')
  }
  const directoryKey = `${manifest.platform}-${manifest.architecture}`
  const root = join(outputDirectory, directoryKey)
  await mkdir(root, { recursive: true })
  if ((await lstat(root)).isSymbolicLink() || resolve(await realpath(root)) !== resolve(root)) {
    throw new Error('Pack output must be canonical')
  }
  const names = managedPiPackArtifactNames(manifest.platform)
  const allowed = new Set(['pack-index.json', ...Object.values(names)])
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (
      !entry.isFile() ||
      !allowed.has(entry.name) ||
      (await lstat(join(root, entry.name))).nlink !== 1
    ) {
      throw new Error('Unexpected Pack output inventory')
    }
  }
  await copyFile(process.execPath, join(root, names.node))
  if (manifest.platform !== 'win32') {
    await chmod(join(root, names.node), 0o755)
  }
  const node = await readFile(join(root, names.node))
  const sbom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    version: 1,
    metadata: {
      component: { type: 'application', name: '@hivecode/managed-pi', version: pins.pi },
      tools: { components: [{ type: 'application', name: 'esbuild', version: esbuildVersion }] },
      properties: [
        { name: 'hive:pi:sourceCommit', value: pins.commit },
        { name: 'hive:lock:sha256', value: packSha256(lock) },
        {
          name: 'hive:node:provenance',
          value: 'controlled-build-host-executable; official distribution checksum not attested'
        },
        { name: 'hive:license:pi:source', value: legal.provenance.pi.url },
        { name: 'hive:license:node:source', value: legal.provenance.node.url }
      ]
    },
    components: [
      {
        type: 'application',
        'bom-ref': `node@${pins.node}`,
        name: 'node',
        version: pins.node,
        hashes: [{ alg: 'SHA-256', content: packSha256(node) }],
        licenses: [{ license: { name: 'Node.js and vendored third-party licenses; see NOTICE' } }]
      },
      ...bundle.components
    ]
  }
  const contents = {
    node,
    runner: result.outputFiles[0].contents,
    package: `${JSON.stringify(
      { ...runtimePackage, type: 'commonjs', main: names.runner, dependencies: {} },
      null,
      2
    )}\n`,
    lock,
    sbom: `${JSON.stringify(sbom, null, 2)}\n`,
    license: legal.pi,
    notice: `HiveCode managed Pi text Pack\n\nNode.js ${pins.node}\n${legal.node}\n\n${bundle.notices}\n`
  }
  const artifacts = Object.fromEntries(
    (Object.keys(names) as (keyof typeof names)[]).map((role) => {
      const content = contents[role]
      return [
        role,
        {
          sha256: packSha256(content),
          size: typeof content === 'string' ? Buffer.byteLength(content) : content.byteLength
        }
      ]
    })
  )
  const index = managedPiPackIndexSchema.parse({ schemaVersion: 1, manifest, artifacts })
  for (const role of Object.keys(names) as (keyof typeof names)[]) {
    if (role !== 'node') {
      await writeFile(join(root, names[role]), contents[role])
    }
  }
  const indexContent = `${JSON.stringify(index, null, 2)}\n`
  await writeFile(join(root, 'pack-index.json'), indexContent)
  const indexSha256 = packSha256(indexContent)
  const loaded = await loadManagedPiTextPack({ rootDirectory: root, indexSha256 })
  loaded.readPack()
  loaded.dispose()
  return Object.freeze({ directoryKey, indexSha256, root, components: sbom.components.length })
}
