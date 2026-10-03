import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Metafile } from 'esbuild'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  collectPackBundleNotices,
  readPackLegalInputs
} from '../build-plugins/managed-pi-pack-notices'

const piVersion = '0.85.1'
const piNames = ['@earendil-works/pi-agent-core', '@earendil-works/pi-ai']
const piLicense = 'MIT\nCopyright (c) preserved upstream attribution\n'
let root: string
let inputs: Metafile['inputs']
let packages: Record<string, { resolution: { integrity: string } }>

async function addPackage(name: string, version: string, licenseFile?: string) {
  const directory = join(root, 'node_modules', name)
  await mkdir(directory, { recursive: true })
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ name, version, license: 'MIT' })
  )
  await writeFile(join(directory, 'index.js'), 'export const fixture = true')
  if (licenseFile) {
    await writeFile(join(directory, licenseFile), `${name} license attribution`)
  }
  inputs[`node_modules/${name}/index.js`] = { bytes: 1, imports: [] }
  packages[`${name}@${version}`] = { resolution: { integrity: 'sha512-fixture' } }
  return directory
}

const collect = () =>
  collectPackBundleNotices(
    root,
    { inputs, outputs: {} },
    JSON.stringify({ packages }),
    piLicense,
    piVersion
  )

beforeEach(async () => {
  const base = resolve('logs', 'managed-pi-pack-tests')
  await mkdir(base, { recursive: true })
  root = await mkdtemp(join(base, 'notices-'))
  inputs = {}
  packages = {}
  for (const name of piNames) {
    await addPackage(name, piVersion)
  }
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('Pack dependency identity and legal inputs', () => {
  it('uses the pinned monorepo license only for pinned Pi packages', async () => {
    const result = await collect()
    expect(result.components.map((item) => item.name)).toEqual(piNames)
    expect(result.notices).toContain(piLicense)
  })

  it.each(['LICENSE-MIT', 'license', 'LICENSE.txt', 'LICENCE'])(
    'preserves packaged license text from %s',
    async (file) => {
      await addPackage('dependency', '1.2.3', file)
      expect((await collect()).notices).toContain('dependency license attribution')
    }
  )

  it('skips an inner module marker and finds the actual package identity', async () => {
    const directory = await addPackage('diff', '8.0.4', 'LICENSE')
    await mkdir(join(directory, 'libesm'))
    await writeFile(join(directory, 'libesm', 'package.json'), '{"type":"module"}')
    await writeFile(join(directory, 'libesm', 'index.js'), 'export const diff = true')
    delete inputs['node_modules/diff/index.js']
    inputs['node_modules/diff/libesm/index.js'] = { bytes: 1, imports: [] }
    expect((await collect()).components).toContainEqual(
      expect.objectContaining({ name: 'diff', version: '8.0.4' })
    )
  })

  it('rejects a missing non-Pi license instead of substituting generic MIT text', async () => {
    await addPackage('unlicensed', '1.0.0')
    await expect(collect()).rejects.toThrow('Missing runner license')
  })

  it('rejects an empty license', async () => {
    const directory = await addPackage('empty', '1.0.0', 'LICENSE')
    await writeFile(join(directory, 'LICENSE'), '')
    await expect(collect()).rejects.toThrow('Missing runner license')
  })

  it('rejects a bundle dependency absent from the lock', async () => {
    delete packages[`${piNames[0]}@${piVersion}`]
    await expect(collect()).rejects.toThrow('missing from lock')
  })

  it('rejects a Pi version that differs from the fixed pin', async () => {
    await addPackage(piNames[0], '0.85.2')
    await expect(collect()).rejects.toThrow('differs from pin')
  })

  it('rejects a runner without both pinned Pi packages', async () => {
    delete inputs[`node_modules/${piNames[1]}/index.js`]
    await expect(collect()).rejects.toThrow('missing pinned Pi dependency')
  })

  it('rejects an unowned source input outside managed dependencies', async () => {
    await writeFile(join(root, 'external.js'), 'export const external = true')
    inputs['external.js'] = { bytes: 1, imports: [] }
    await expect(collect()).rejects.toThrow('Unexpected runner build input')
  })

  it('checks the stored license hashes and source versions', async () => {
    const productRuntime = resolve('runtime/managed-pi')
    const pins = {
      node: '24.18.0',
      pi: piVersion,
      commit: 'd981de1229ef899957bbe968bc8dcda02a21f477'
    }
    const original = await readPackLegalInputs(productRuntime, pins)
    await mkdir(join(root, 'legal'))
    for (const file of ['provenance.json', 'pi-LICENSE', 'node-LICENSE']) {
      await writeFile(
        join(root, 'legal', file),
        await readFile(join(productRuntime, 'legal', file))
      )
    }
    expect((await readPackLegalInputs(root, pins)).pi).toBe(original.pi)
    await expect(readPackLegalInputs(root, { ...pins, node: '24.18.1' })).rejects.toThrow(
      'do not match'
    )
    await writeFile(join(root, 'legal/pi-LICENSE'), 'modified license')
    await expect(readPackLegalInputs(root, pins)).rejects.toThrow('do not match')
  })
})
