import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { lock } from 'proper-lockfile'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  materializeReleaseCheckout,
  REPO_ROOT,
  type CheckoutStagingContext
} from './release-checkout'
import { CHECKOUT_FORMAT } from './release-checkout-publication'

const fixture = vi.hoisted(() => ({ files: new Map<string, string>(), commit: '1'.repeat(40) }))

// Exercise the actual materializer without writing a fake historical cache or extracting source.
vi.mock('node:child_process', () => ({ execFileSync: vi.fn(() => fixture.commit) }))
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
const cacheIdentity = join(REF, `${COMMIT}-format-${CHECKOUT_FORMAT}`)
const newRoot = join(REPO_ROOT, 'logs', 'cross-version-checkouts', cacheIdentity)
const oldRoot = join(REPO_ROOT, 'tests', 'e2e', '.cross-version-checkouts', cacheIdentity)

function seed(root: string, commit = COMMIT, format = CHECKOUT_FORMAT): void {
  fixture.files.set(join(root, 'checkout-stamp.json'), JSON.stringify({ commit, format }))
  fixture.files.set(join(root, 'src', 'shared', 'terminal-stream-protocol.ts'), 'verified fixture')
}

async function populate({ staging }: CheckoutStagingContext): Promise<void> {
  await fs.writeFile(join(staging, 'src', 'shared', 'terminal-stream-protocol.ts'), 'new fixture')
}

beforeEach(() => {
  fixture.files.clear()
  vi.clearAllMocks()
  fixture.commit = COMMIT
})

describe('release checkout writable cache boundary', () => {
  it('writes a new default checkout only under project logs', async () => {
    const checkout = await materializeReleaseCheckout(REF, {
      testHooks: { populateStaging: populate }
    })
    expect(checkout.root).toBe(newRoot)
    expect(fs.rename).toHaveBeenCalledWith(expect.any(String), newRoot)
    expect(fixture.files.get(join(newRoot, 'checkout-stamp.json'))).toBe(
      `${JSON.stringify({ commit: COMMIT, format: CHECKOUT_FORMAT }, null, 2)}\n`
    )
  })

  it('leaves the pre-policy format-six checkout untouched and creates the new format', async () => {
    const legacyRoot = join(REPO_ROOT, 'logs', 'cross-version-checkouts', REF, `${COMMIT}-format-6`)
    seed(legacyRoot, COMMIT, 6)
    const oldStamp = fixture.files.get(join(legacyRoot, 'checkout-stamp.json'))
    const checkout = await materializeReleaseCheckout(REF, {
      testHooks: { populateStaging: populate }
    })
    expect(checkout.root).toBe(newRoot)
    expect(fixture.files.get(join(legacyRoot, 'checkout-stamp.json'))).toBe(oldStamp)
    expect(fs.rm).not.toHaveBeenCalledWith(legacyRoot, expect.anything())
    expect(fs.rename).toHaveBeenCalledWith(expect.any(String), newRoot)
  })

  it('leaves a verified historical checkout untouched and creates the owned logs cache', async () => {
    seed(oldRoot)
    const oldStamp = fixture.files.get(join(oldRoot, 'checkout-stamp.json'))
    const checkout = await materializeReleaseCheckout(REF, {
      testHooks: { populateStaging: populate }
    })
    expect(checkout.root).toBe(newRoot)
    expect(fixture.files.get(join(oldRoot, 'checkout-stamp.json'))).toBe(oldStamp)
    expect(fixture.files.get(join(oldRoot, 'src', 'shared', 'terminal-stream-protocol.ts'))).toBe(
      'verified fixture'
    )
    expect(fs.readFile).not.toHaveBeenCalledWith(join(oldRoot, 'checkout-stamp.json'), 'utf8')
    expect(fs.rm).not.toHaveBeenCalledWith(oldRoot, expect.anything())
    expect(fs.rename).toHaveBeenCalledWith(expect.any(String), newRoot)
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

  describe('declared aliases of one immutable upstream commit', () => {
    const pinnedCommit = '5534462b50c660888487a2108700d4cf284270db'
    const aliasIdentity = join('v1.4.211', `${pinnedCommit}-format-${CHECKOUT_FORMAT}`)
    const aliasRoot = join(REPO_ROOT, 'logs', 'cross-version-checkouts', aliasIdentity)
    beforeEach(() => {
      fixture.commit = pinnedCommit
    })

    it.each(['logs', 'historical'] as const)(
      'leaves a verified %s release label untouched and uses the requested exact SHA',
      async (location) => {
        const root =
          location === 'logs'
            ? aliasRoot
            : join(REPO_ROOT, 'tests', 'e2e', '.cross-version-checkouts', aliasIdentity)
        seed(root, pinnedCommit)
        const oldStamp = fixture.files.get(join(root, 'checkout-stamp.json'))
        const checkout = await materializeReleaseCheckout(pinnedCommit, {
          testHooks: { populateStaging: populate }
        })
        const exactRoot = join(
          REPO_ROOT,
          'logs',
          'cross-version-checkouts',
          pinnedCommit,
          `${pinnedCommit}-format-${CHECKOUT_FORMAT}`
        )
        expect(checkout).toMatchObject({
          ref: pinnedCommit,
          commit: pinnedCommit,
          label: pinnedCommit,
          root: exactRoot
        })
        expect(fixture.files.get(join(root, 'checkout-stamp.json'))).toBe(oldStamp)
        expect(fs.readFile).not.toHaveBeenCalledWith(join(root, 'checkout-stamp.json'), 'utf8')
        expect(fs.rm).not.toHaveBeenCalledWith(root, expect.anything())
        expect(fs.rename).toHaveBeenCalledWith(expect.any(String), exactRoot)
        expect(lock).toHaveBeenCalledWith(exactRoot, expect.any(Object))
      }
    )

    it.each([
      { kind: 'commit', commit: COMMIT, format: CHECKOUT_FORMAT, wire: true },
      { kind: 'format', commit: pinnedCommit, format: 5, wire: true },
      { kind: 'wire surface', commit: pinnedCommit, format: CHECKOUT_FORMAT, wire: false }
    ])(
      'rejects an alias with a mismatched $kind without repairing it',
      async ({ commit, format, wire }) => {
        seed(aliasRoot, commit, format)
        if (!wire) {
          fixture.files.delete(join(aliasRoot, 'src/shared/terminal-stream-protocol.ts'))
        }
        const oldStamp = fixture.files.get(join(aliasRoot, 'checkout-stamp.json'))
        const checkout = await materializeReleaseCheckout(pinnedCommit, {
          testHooks: { populateStaging: populate }
        })
        expect(checkout.root).toBe(
          join(
            REPO_ROOT,
            'logs',
            'cross-version-checkouts',
            pinnedCommit,
            `${pinnedCommit}-format-${CHECKOUT_FORMAT}`
          )
        )
        expect(fixture.files.get(join(aliasRoot, 'checkout-stamp.json'))).toBe(oldStamp)
        expect(fs.rm).not.toHaveBeenCalledWith(aliasRoot, expect.anything())
      }
    )

    it('keeps an explicit cache root isolated from a verified default alias', async () => {
      seed(aliasRoot, pinnedCommit)
      const cacheRoot = join(REPO_ROOT, 'logs', 'explicit-pinned-alias-fixture')
      const checkout = await materializeReleaseCheckout(pinnedCommit, {
        cacheRoot,
        testHooks: { populateStaging: populate }
      })
      expect(checkout.root).toBe(
        join(cacheRoot, pinnedCommit, `${pinnedCommit}-format-${CHECKOUT_FORMAT}`)
      )
      expect(fs.readFile).not.toHaveBeenCalledWith(join(aliasRoot, 'checkout-stamp.json'), 'utf8')
      expect(fixture.files.get(join(aliasRoot, 'checkout-stamp.json'))).toBe(
        JSON.stringify({ commit: pinnedCommit, format: CHECKOUT_FORMAT })
      )
    })
  })
})
