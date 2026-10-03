import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { vendorFeatureWallAssets } from './vendor-feature-wall-assets.mjs'

const { gitLog } = vi.hoisted(() => ({
  gitLog: vi.fn(() => ({ status: 0, stdout: '1788159085\n', stderr: '' }))
}))
vi.mock('node:child_process', () => ({ spawnSync: gitLog }))

const fixtureParent = path.resolve('logs/private-docs-migration/vendor-fixtures')
const roots = []
afterEach(async () => {
  gitLog.mockClear()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  await mkdir(fixtureParent, { recursive: true })
  const root = await mkdtemp(path.join(fixtureParent, 'public-'))
  roots.push(root)
  const dest = path.join(root, 'resources', 'onboarding', 'feature-wall')
  const marketingRepo = path.join(root, 'marketing')
  await mkdir(dest, { recursive: true })
  for (const extension of ['gif', 'poster.jpg', 'recorded-at.json']) {
    const name = `tile-01.${extension}`
    await writeFile(
      path.join(dest, name),
      await readFile(`resources/onboarding/feature-wall/${name}`)
    )
  }
  for (let index = 2; index <= 12; index++) {
    const id = `tile-${String(index).padStart(2, '0')}`
    const provenance = JSON.parse(
      await readFile(`resources/onboarding/feature-wall/${id}.recorded-at.json`, 'utf8')
    )
    for (const key of ['sourceGif', 'sourcePoster']) {
      const file = path.join(marketingRepo, provenance[key])
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, `${id} fixture ${key}`)
    }
  }
  return { root, dest, marketingRepo }
}

describe('feature-wall asset source ownership', () => {
  it('preserves owned recording bytes while importing marketing assets without private docs', async () => {
    const inputs = await fixture()
    await vendorFeatureWallAssets(inputs)

    for (const extension of ['gif', 'poster.jpg', 'recorded-at.json']) {
      const name = `tile-01.${extension}`
      expect(await readFile(path.join(inputs.dest, name))).toEqual(
        await readFile(`resources/onboarding/feature-wall/${name}`)
      )
    }
    expect(gitLog).toHaveBeenCalledTimes(11)
    for (const [, , options] of gitLog.mock.calls) {
      expect(options.cwd).toBe(inputs.marketingRepo)
    }
    expect(await readFile(path.join(inputs.dest, 'tile-12.gif'), 'utf8')).toBe(
      'tile-12 fixture sourceGif'
    )
  })

  it('reports an unavailable owned recording instead of regenerating its provenance', async () => {
    const inputs = await fixture()
    await rm(path.join(inputs.dest, 'tile-01.recorded-at.json'))
    await expect(vendorFeatureWallAssets(inputs)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(gitLog).not.toHaveBeenCalled()
  })
})
