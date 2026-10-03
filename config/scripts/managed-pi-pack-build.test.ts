import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { produceManagedPiTextPack } from '../build-plugins/managed-pi-pack-producer'
import { packSha256 } from '../build-plugins/managed-pi-pack-notices'
import {
  managedPiPackArtifactNames,
  managedPiPackIndexSchema
} from '../../src/main/runtime/managed-pi-pack-index'
import { loadManagedPiTextPack } from '../../src/main/runtime/managed-pi-pack-loader'
import { createManagedPiEnvironment } from '../../src/main/runtime/managed-pi-environment'
import { runProcess } from '../../src/shared/child-process/run-process'
import {
  getProductManagedPiPackIdentity as getUncompiledPackIdentity,
  type loadProductManagedPiTextPack
} from '../../src/main/runtime/managed-pi-pack-product'

const require = createRequire(import.meta.url)
const projectRoot = resolve('.')
let root: string
let pack: Awaited<ReturnType<typeof produceManagedPiTextPack>>
let product: {
  getProductManagedPiPackIdentity: typeof getUncompiledPackIdentity
  loadProductManagedPiTextPack: typeof loadProductManagedPiTextPack
}
const { verifyPackagedManagedPiTextPack } = require('../managed-pi-pack-resources.cjs')

beforeAll(async () => {
  const base = join(projectRoot, 'logs', 'managed-pi-pack-tests')
  await mkdir(base, { recursive: true })
  root = await mkdtemp(join(base, 'build-'))
  pack = await produceManagedPiTextPack(projectRoot, join(root, 'managed-pi'))
  await build({
    absWorkingDir: projectRoot,
    entryPoints: ['src/main/runtime/managed-pi-pack-product.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: join(root, 'out', 'main', 'managed-pi-pack-product.js'),
    define: {
      HIVECODE_MANAGED_PI_PACK_TRUST: JSON.stringify({ [pack.directoryKey]: pack.indexSha256 })
    },
    logLevel: 'silent'
  })
  product = require(join(root, 'out', 'main', 'managed-pi-pack-product.js'))
})

afterAll(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true })
  }
})

describe('managed Pi Pack product build', () => {
  it('reports missing build trust explicitly for an uncompiled product module', () => {
    expect(() => getUncompiledPackIdentity()).toThrow('hive_agent_pack_unavailable')
  })
  it('emits exactly eight bounded, hashed artifacts accepted by the real loader', async () => {
    const text = await readFile(join(pack.root, 'pack-index.json'), 'utf8')
    const index = managedPiPackIndexSchema.parse(JSON.parse(text))
    const names = managedPiPackArtifactNames(process.platform)
    expect(packSha256(text)).toBe(pack.indexSha256)
    expect((await readdir(pack.root)).sort()).toEqual(
      ['pack-index.json', ...Object.values(names)].sort()
    )
    for (const role of Object.keys(names) as (keyof typeof names)[]) {
      const bytes = await readFile(join(pack.root, names[role]))
      expect(bytes.byteLength).toBe(index.artifacts[role].size)
      expect(packSha256(bytes)).toBe(index.artifacts[role].sha256)
    }
    const loaded = await loadManagedPiTextPack({
      rootDirectory: pack.root,
      indexSha256: pack.indexSha256
    })
    expect(loaded.readPack()?.manifest).toMatchObject({
      capabilities: ['local.text'],
      packRevision: pack.indexSha256,
      platform: process.platform,
      architecture: process.arch
    })
    loaded.dispose()
    expect(() => loaded.getLaunchFiles()).toThrow('hive_agent_pack_unavailable')
  })

  it('records the real bundle closure and preserves Pi, Node and dependency notices', async () => {
    const sbom = JSON.parse(await readFile(join(pack.root, 'sbom.json'), 'utf8'))
    expect(sbom).toMatchObject({ bomFormat: 'CycloneDX', specVersion: '1.6' })
    expect(sbom.components.map((item: { name: string }) => item.name)).toEqual(
      expect.arrayContaining([
        'node',
        '@earendil-works/pi-agent-core',
        '@earendil-works/pi-ai',
        'diff',
        'ignore',
        'yaml'
      ])
    )
    expect(sbom.components.every((item: { version: string }) => Boolean(item.version))).toBe(true)
    expect(new Set(sbom.components.map((item: { name: string }) => item.name)).size).toBe(
      sbom.components.length
    )
    const notice = await readFile(join(pack.root, 'NOTICE'), 'utf8')
    expect(notice).toContain(
      await readFile(join(projectRoot, 'runtime/managed-pi/legal/node-LICENSE'), 'utf8')
    )
    expect(notice).toContain(
      await readFile(join(projectRoot, 'runtime/managed-pi/legal/pi-LICENSE'), 'utf8')
    )
    expect(notice).toContain('ignore@7.0.5')
    expect(
      JSON.parse(await readFile(join(pack.root, 'package.json'), 'utf8')).dependencies
    ).toEqual({})
  })

  it('loads the self-contained runner with its copied Node and an allowlisted environment', async () => {
    const names = managedPiPackArtifactNames(process.platform)
    const result = await runProcess({
      program: join(pack.root, names.node),
      args: [
        '-e',
        `const r=require(${JSON.stringify(join(pack.root, names.runner))});let rejected=false;try{r.createManagedTextAgent({model:{id:'fixture'}})}catch{rejected=true};const a=r.createManagedTextAgent({model:{id:'fixture'},streamFn:()=>{throw Error('unexpected inference')}});console.log(JSON.stringify({rejected,tools:a.state.tools,model:a.state.model.id}))`
      ],
      cwd: pack.root,
      env: createManagedPiEnvironment(process.env, pack.root),
      timeoutMs: 10_000,
      maxOutputBytes: 1024,
      terminationBarrier: true
    })
    expect(result).toMatchObject({
      code: 0,
      signal: null,
      timedOut: false,
      outputTruncated: false,
      stderr: ''
    })
    expect(JSON.parse(result.stdout)).toEqual({ rejected: true, tools: [], model: 'fixture' })
  })

  it('compiles immutable product trust and loads a copied desktop resource tree', async () => {
    const resources = join(root, 'app', 'resources')
    await cp(pack.root, join(resources, 'managed-pi', pack.directoryKey), { recursive: true })
    const identity = product.getProductManagedPiPackIdentity()
    expect(identity).toEqual({ directoryKey: pack.directoryKey, indexSha256: pack.indexSha256 })
    expect(Object.isFrozen(identity)).toBe(true)
    const loaded = await product.loadProductManagedPiTextPack(resources)
    expect(loaded.readPack()?.manifest).toMatchObject({ packRevision: pack.indexSha256 })
    loaded.dispose()
  })

  it('runs the packaging gate against real copied files and rejects corruption', async () => {
    const appOutDir = join(root, 'gated-app')
    const resources =
      process.platform === 'darwin'
        ? join(appOutDir, 'HiveCode.app', 'Contents', 'Resources')
        : join(appOutDir, 'resources')
    const destination = join(resources, 'managed-pi', pack.directoryKey)
    await cp(pack.root, destination, { recursive: true })
    const context = {
      appOutDir,
      electronPlatformName: process.platform,
      arch: process.arch === 'x64' ? 1 : 3,
      packager: { appInfo: { productFilename: 'HiveCode' } }
    }
    await expect(verifyPackagedManagedPiTextPack(context, root)).resolves.toBeUndefined()
    await writeFile(join(destination, 'agent.cjs'), 'corrupt')
    await expect(verifyPackagedManagedPiTextPack(context, root)).rejects.toThrow(
      'hive_agent_pack_unavailable'
    )
    await copyFile(join(pack.root, 'agent.cjs'), join(destination, 'agent.cjs'))
    await expect(verifyPackagedManagedPiTextPack(context, root)).resolves.toBeUndefined()
  })

  it.each([
    ['unsupported', 'x64'],
    [process.platform, 'ia32'],
    [process.platform, process.arch === 'x64' ? 'arm64' : 'x64']
  ])('rejects absent compiled target trust %s/%s', (platform, architecture) => {
    expect(() => product.getProductManagedPiPackIdentity(platform, architecture)).toThrow(
      'hive_agent_pack_unavailable'
    )
  })

  it('does not accept a self-rehashed install index as product trust', async () => {
    const resources = join(root, 'self-rehashed')
    const destination = join(resources, 'managed-pi', pack.directoryKey)
    await cp(pack.root, destination, { recursive: true })
    const index = JSON.parse(await readFile(join(destination, 'pack-index.json'), 'utf8'))
    index.manifest.profiles[0].profileId = 'forged'
    await writeFile(join(destination, 'pack-index.json'), JSON.stringify(index))
    await expect(product.loadProductManagedPiTextPack(resources)).rejects.toThrow(
      'hive_agent_pack_unavailable'
    )
    await expect(product.loadProductManagedPiTextPack('relative')).rejects.toThrow(
      'hive_agent_pack_unavailable'
    )
  })

  it('rebuilds the same digest and revokes previously loaded file guards', async () => {
    const loaded = await loadManagedPiTextPack({
      rootDirectory: pack.root,
      indexSha256: pack.indexSha256
    })
    const rebuilt = await produceManagedPiTextPack(projectRoot, join(root, 'managed-pi'))
    expect(rebuilt.indexSha256).toBe(pack.indexSha256)
    expect(() => loaded.getLaunchFiles()).toThrow('hive_agent_pack_unavailable')
    loaded.dispose()
  })
})
