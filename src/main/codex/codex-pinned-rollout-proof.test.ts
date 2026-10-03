import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { resolvePinnedCodexRolloutProof } from './codex-pinned-rollout-proof'

const THREAD = '019fd900-77aa-7c19-8bd0-2b3c4d5e6f70'
const OTHER_THREAD = '019fd900-77aa-7c19-8bd0-2b3c4d5e6f71'
const PINNED_HOME = resolve('/pinned')
const PINNED_ROLLOUT = join(
  PINNED_HOME,
  'sessions',
  '2026',
  '08',
  '11',
  `rollout-now-${THREAD}.jsonl`
)

describe('Codex pinned rollout proof', () => {
  it('resolves only the exact session_meta rollout under the pinned account home', async () => {
    const files = async function* (): AsyncGenerator<string> {
      yield join(PINNED_HOME, 'sessions', 'scratch', 'rollout-wrong.jsonl')
      yield join(resolve('/other'), 'sessions', '2026', '08', '11', `rollout-now-${THREAD}.jsonl`)
      yield PINNED_ROLLOUT
    }
    const readSessionMetaId = vi.fn(async () => THREAD)

    await expect(
      resolvePinnedCodexRolloutProof(PINNED_HOME, THREAD, { listFiles: files, readSessionMetaId })
    ).resolves.toBe(PINNED_ROLLOUT)
    expect(readSessionMetaId).toHaveBeenCalledTimes(1)
    expect(readSessionMetaId).toHaveBeenCalledWith(PINNED_ROLLOUT)
  })

  it('accepts Codex rollout ids with a distinct rollout suffix', async () => {
    const files = async function* (): AsyncGenerator<string> {
      yield join(
        PINNED_HOME,
        'sessions',
        '2026',
        '08',
        '11',
        `rollout-now-${THREAD}_${OTHER_THREAD}.jsonl`
      )
    }
    const readSessionMetaId = vi.fn(async () => THREAD)

    await expect(
      resolvePinnedCodexRolloutProof(PINNED_HOME, THREAD, { listFiles: files, readSessionMetaId })
    ).resolves.toContain(`rollout-now-${THREAD}_`)
  })

  it('skips a rollout file that vanishes mid-scan instead of aborting the proof', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-rollout-proof-'))
    try {
      const day = join(root, 'sessions', '2026', '08', '11')
      await mkdir(day, { recursive: true })
      const real = join(day, `rollout-now-${THREAD}.jsonl`)
      await writeFile(
        real,
        `${JSON.stringify({ type: 'session_meta', payload: { id: THREAD } })}\n`
      )
      // Listed but already deleted by the time the scan reads it — Codex prunes
      // and rewrites rollout files while the scan runs.
      const vanished = join(day, `rollout-gone-${THREAD}.jsonl`)
      const files = async function* (): AsyncGenerator<string> {
        yield vanished
        yield real
      }

      await expect(
        resolvePinnedCodexRolloutProof(root, THREAD, { listFiles: files })
      ).resolves.toBe(real)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a rollout whose session_meta names another thread', async () => {
    const files = async function* (): AsyncGenerator<string> {
      yield PINNED_ROLLOUT
    }
    await expect(
      resolvePinnedCodexRolloutProof(PINNED_HOME, THREAD, {
        listFiles: files,
        readSessionMetaId: async () => OTHER_THREAD
      })
    ).resolves.toBeNull()
  })
})
