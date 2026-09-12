import { beforeEach, expect, it, vi } from 'vitest'
import { runProcess } from '../../../src/shared/child-process/run-process'
import { extractReleaseCheckoutTree } from './release-checkout-tree'

vi.mock('../../../src/shared/child-process/run-process', () => ({ runProcess: vi.fn() }))
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(async () => []),
  rm: vi.fn(),
  writeFile: vi.fn()
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(runProcess).mockResolvedValue({
    code: 0,
    signal: null,
    timedOut: false,
    stdout: '',
    stderr: ''
  })
})

it('excludes discarded test sources before they consume the shared extraction deadline', async () => {
  await extractReleaseCheckoutTree('/repository', '/staging', 'a'.repeat(40))
  const extraction = vi.mocked(runProcess).mock.calls[1][0]
  expect(extraction.args).toEqual(
    expect.arrayContaining([
      '--exclude=*.test.ts',
      '--exclude=*.test.tsx',
      '--exclude=*.spec.ts',
      '--exclude=*.spec.tsx',
      '--exclude=*.bench.ts',
      '--exclude=*.bench.tsx'
    ])
  )
  expect(extraction.timeoutMs).toBeLessThanOrEqual(45_000)
  expect(extraction.terminationBarrier).toBe(true)
})
