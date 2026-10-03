import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { lock } from 'proper-lockfile'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  materializeReleaseCheckout,
  REPO_ROOT,
  type CheckoutStagingContext
} from './release-checkout'

const fixture = vi.hoisted(() => ({ files: new Map<string, string>() }))

// Exercise the actual materializer without writing a fake historical cache or extracting source.
vi.mock('node:child_process', () => ({ execFileSync: vi.fn(() => '1'.repeat(40)) }))
vi.mock('proper-lockfile', () => ({ lock: vi.fn(async () => async () => undefined) }))
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async (path: string) => {
    const value = fixture.files.get(path)
    if (value === undefined) {
      throw new Error(`ENOENT: ${path}`)
    }
    return value
  }),
  access: vi.fn(async (path: string) => {
    if (!fixture.files.has(path)) {
      throw new Error(`ENOENT: ${path}`)
    }
  }),
  mkdir: vi.fn(async () => undefined),
  mkdtemp: vi.fn(async (prefix: string) => `${prefix}fixture`),
  writeFile: vi.fn(async (path: string, value: string) => {
    fixture.files.set(path, value)
  }),
  rename: vi.fn(async (from: string, to: string) => {
    for (const [path, value] of fixture.files) {
      if (path.startsWith(from)) {
        fixture.files.delete(path)
        fixture.files.set(`${to}${path.slice(from.length)}`, value)
      }
    }
  }),
  rm: vi.fn(async (root: string) => {
    for (const path of fixture.files.keys()) {
      if (path.startsWith(root)) {
        fixture.files.delete(path)
      }
    }
  }),
  readdir: vi.fn(async () => [])
}))

const REF = 'fixture-revision'
const COMMIT = '1'.repeat(40)
const cacheIdentity = join(REF, `${COMMIT}-format-4`)
const newRoot = join(REPO_ROOT, 'logs', 'cross-version-checkouts', cacheIdentity)
const oldRoot = join(REPO_ROOT, 'tests', 'e2e', '.cross-version-checkouts', cacheIdentity)

function seed(root: string, commit = COMMIT, format = 4): void {
  fixture.files.set(join(root, 'checkout-stamp.json'), JSON.stringify({ commit, format }))
  fixture.files.set(join(root, 'src', 'shared', 'terminal-stream-protocol.ts'), 'verified fixture')
}

async function populate({ staging }: CheckoutStagingContext): Promise<void> {
  await fs.writeFile(join(staging, 'src', 'shared', 'terminal-stream-protocol.ts'), 'new fixture')
}

beforeEach(() => {
  fixture.files.clear()
  vi.clearAllMocks()
})

describe('release checkout writable cache boundary', () => {
  it('writes a new default checkout only under project logs', async () => {
    const checkout = await materializeReleaseCheckout(REF, {
      testHooks: { populateStaging: populate }
    })
    expect(checkout.root).toBe(newRoot)
    expect(fs.rename).toHaveBeenCalledWith(expect.any(String), newRoot)
    expect(fixture.files.get(join(newRoot, 'checkout-stamp.json'))).toBe(
      `${JSON.stringify({ commit: COMMIT, format: 4 }, null, 2)}\n`
    )
  })

  it('reuses a verified historical checkout without any cache mutations', async () => {
    seed(oldRoot)
    const before = [...fixture.files]
    const checkout = await materializeReleaseCheckout(REF)
    expect(checkout.root).toBe(oldRoot)
    expect([...fixture.files]).toEqual(before)
    for (const mutation of [fs.mkdir, fs.mkdtemp, fs.writeFile, fs.rename, fs.rm, lock]) {
      expect(mutation).not.toHaveBeenCalled()
    }
  })

  it.each([
    { kind: 'commit', commit: '2'.repeat(40), format: 3 },
    { kind: 'format', commit: COMMIT, format: 2 }
  ])('never repairs an old cache with a mismatched $kind stamp', async ({ commit, format }) => {
    seed(oldRoot, commit, format)
    const oldStamp = fixture.files.get(join(oldRoot, 'checkout-stamp.json'))
    const checkout = await materializeReleaseCheckout(REF, {
      testHooks: { populateStaging: populate }
    })
    expect(checkout.root).toBe(newRoot)
    expect(fixture.files.get(join(oldRoot, 'checkout-stamp.json'))).toBe(oldStamp)
    expect(fixture.files.get(join(oldRoot, 'src', 'shared', 'terminal-stream-protocol.ts'))).toBe(
      'verified fixture'
    )
    expect(fs.rm).not.toHaveBeenCalledWith(oldRoot, expect.anything())
  })

  it('prefers a verified logs cache over the historical location', async () => {
    seed(newRoot)
    seed(oldRoot)
    expect((await materializeReleaseCheckout(REF)).root).toBe(newRoot)
    expect(fs.readFile).not.toHaveBeenCalledWith(join(oldRoot, 'checkout-stamp.json'), 'utf8')
    expect(lock).not.toHaveBeenCalled()
  })

  it('keeps explicit cacheRoot callers isolated from the historical default', async () => {
    seed(oldRoot)
    const cacheRoot = join(REPO_ROOT, 'logs', 'explicit-fixture-cache')
    const checkout = await materializeReleaseCheckout(REF, {
      cacheRoot,
      testHooks: { populateStaging: populate }
    })
    expect(checkout.root).toBe(join(cacheRoot, cacheIdentity))
    expect(fs.readFile).not.toHaveBeenCalledWith(join(oldRoot, 'checkout-stamp.json'), 'utf8')
  })
})
