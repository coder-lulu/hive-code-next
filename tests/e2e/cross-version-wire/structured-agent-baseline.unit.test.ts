import { execFileSync } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { resolvePinnedUpstreamRef } from '../../../config/scripts/prepare-cross-version-baselines.mjs'
import {
  REPO_ROOT,
  resolveBaselineReleaseRef,
  resolveStructuredAgentBaselineReleaseRef
} from './release-checkout'

afterEach(() => vi.unstubAllEnvs())

it('retains the legacy protocol pairing while selecting a real published structured reader', () => {
  vi.stubEnv('ORCA_CROSS_VERSION_BASELINE_REF', 'v1.4.186')
  vi.stubEnv('ORCA_STRUCTURED_AGENT_BASELINE_REF', '')
  expect(resolveBaselineReleaseRef()).toBe('v1.4.186')
  const ref = resolveStructuredAgentBaselineReleaseRef()
  expect(ref).toBe('v1.4.221')
  const commit = resolvePinnedUpstreamRef(ref)
  expect(commit).toBe('9dd8812384db85d0b4ede2d1e37f9d73bdb4ea8c')
  for (const path of [
    'src/shared/agent-session-record.ts',
    'src/shared/agent-session-refusal-notice.ts',
    'src/renderer/src/components/native-chat/structured-agent-session-tabs.ts'
  ]) {
    expect(() =>
      execFileSync('git', ['cat-file', '-e', `${commit}:${path}`], { cwd: REPO_ROOT })
    ).not.toThrow()
  }
  expect(() =>
    execFileSync(
      'git',
      [
        'cat-file',
        '-e',
        `${resolvePinnedUpstreamRef('v1.4.186')}:src/shared/agent-session-record.ts`
      ],
      { cwd: REPO_ROOT, stdio: 'pipe' }
    )
  ).toThrow()
})

it('permits an explicit structured-reader pairing without changing the protocol baseline', () => {
  vi.stubEnv('ORCA_CROSS_VERSION_BASELINE_REF', 'v1.4.186')
  vi.stubEnv('ORCA_STRUCTURED_AGENT_BASELINE_REF', ' v1.4.219 ')
  expect(resolveStructuredAgentBaselineReleaseRef()).toBe('v1.4.219')
  expect(resolveBaselineReleaseRef()).toBe('v1.4.186')
})
