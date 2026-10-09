import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('@parcel/watcher', () => ({ subscribe: vi.fn() }))
import { createRelayFileListingRequestHarness } from './fs-list-files-dispatch-test-harness'
import { configureRelayBundledRipgrep } from './relay-bundled-ripgrep'
import { bundledRipgrepCommand } from '../main/ripgrep/bundled-ripgrep-path'
import { QUICK_OPEN_LISTING_MAX_RESULTS } from '../shared/quick-open-listing-limits'
let root: string
let paths: string[]
let harness: ReturnType<typeof createRelayFileListingRequestHarness>

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-relay-dispatched-candidates-'))
  harness = createRelayFileListingRequestHarness()
  configureRelayBundledRipgrep(bundledRipgrepCommand())
  await mkdir(join(root, '.git'))
  await writeFile(join(root, '.gitignore'), 'ignored.ts\n')
  await writeFile(join(root, 'ignored.ts'), '')
  paths = Array.from({ length: QUICK_OPEN_LISTING_MAX_RESULTS + 100 }, (_, i) => `file-${i}.ts`)
  for (const path of paths) {
    writeFileSync(join(root, path), '')
  }
})

afterEach(async () => {
  try {
    await harness.dispose()
  } finally {
    configureRelayBundledRipgrep(undefined)
    await rm(root, { recursive: true, force: true })
  }
})

it('dispatches a real late candidate beyond the capped inventory and preserves ignore policy', async () => {
  const inventory = await harness.request({
    rootPath: root,
    includeIgnored: false,
    maxResults: QUICK_OPEN_LISTING_MAX_RESULTS
  })
  const retained = new Set(inventory)
  const omitted = paths.find((path) => !retained.has(path))
  expect(omitted).toBeDefined()
  if (!omitted) {
    throw new Error('Fixture has no omitted candidate')
  }
  await expect(
    harness.request({
      rootPath: root,
      includeIgnored: false,
      candidatePaths: [omitted, 'ignored.ts', 'deleted.ts'],
      maxResults: 3
    })
  ).resolves.toEqual([omitted])
  await expect(
    harness.request({
      rootPath: root,
      includeIgnored: true,
      candidatePaths: ['ignored.ts'],
      maxResults: 1
    })
  ).resolves.toEqual(['ignored.ts'])
  expect(inventory).toHaveLength(QUICK_OPEN_LISTING_MAX_RESULTS)
}, 30_000)
