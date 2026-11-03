import { describe, expect, it } from 'vitest'
import { wholeAgentEnvironmentUpdates } from './agent-launch-permission-updates'
import {
  measureSettingsWork,
  expectSettingsWorkScale
} from './agent-launch-settings-work.test-helper'
import { resolveAgentPermission } from './tui-agent-permission-choice'

const platforms = ['darwin', 'linux', 'win32'] as const

describe('whole agent environment updates', () => {
  it.each(platforms)(
    'returns no update for equivalent normalized environment on %s',
    (platform) => {
      const settings = { agentDefaultEnv: { claude: { A: '', Path: 'same', KEEP: '1' } } }
      expect(
        wholeAgentEnvironmentUpdates(
          settings,
          'claude',
          {
            ' KEEP ': '1',
            ' Path ': 'same',
            ' A ': '',
            ' ': 'ignored'
          },
          platform
        )
      ).toEqual({})
    }
  )

  it.each(platforms)('does not create an empty override when none exists on %s', (platform) => {
    expect(wholeAgentEnvironmentUpdates({}, 'claude', {}, platform)).toEqual({})
  })

  it.each(platforms)(
    'normalizes names and preserves last spelling under %s case rules',
    (platform) => {
      const requested = { ' Path ': 'first', KEEP: '1', PATH: 'second', path: 'last' }
      const updates = wholeAgentEnvironmentUpdates({}, 'claude', requested, platform)
      expect(updates.agentDefaultEnv?.claude).toEqual(
        platform === 'win32'
          ? { KEEP: '1', path: 'last' }
          : { Path: 'first', KEEP: '1', PATH: 'second', path: 'last' }
      )
      expect(Object.keys(updates.agentDefaultEnv?.claude ?? {})).toEqual(
        platform === 'win32' ? ['KEEP', 'path'] : ['Path', 'KEEP', 'PATH', 'path']
      )
      expect(requested).toEqual({ ' Path ': 'first', KEEP: '1', PATH: 'second', path: 'last' })
    }
  )

  it.each(platforms)(
    'keeps the last normalized alias even after an earlier differently cased alias on %s',
    (platform) => {
      const updates = wholeAgentEnvironmentUpdates(
        {},
        'claude',
        { Path: 'first', PATH: 'second', ' Path ': 'last' },
        platform
      )
      expect(updates.agentDefaultEnv?.claude).toEqual(
        platform === 'win32' ? { Path: 'last' } : { Path: 'last', PATH: 'second' }
      )
    }
  )

  it.each(platforms)(
    'atomically clears the selected agent and keeps the latest sibling on %s',
    (platform) => {
      const previous = {
        agentDefaultEnv: { claude: { A: 'old', B: 'remove' }, gemini: { TOKEN: 'old' } }
      }
      const latest = {
        ...previous,
        agentDefaultEnv: { ...previous.agentDefaultEnv, gemini: { TOKEN: 'latest' } }
      }
      const updates = wholeAgentEnvironmentUpdates(latest, 'claude', {}, platform)
      expect(updates).toEqual({ agentDefaultEnv: { claude: {}, gemini: { TOKEN: 'latest' } } })
      expect(latest.agentDefaultEnv.claude).toEqual({ A: 'old', B: 'remove' })
      expect(previous.agentDefaultEnv.gemini).toEqual({ TOKEN: 'old' })
      expect(
        wholeAgentEnvironmentUpdates({ ...latest, ...updates }, 'claude', {}, platform)
      ).toEqual({})
    }
  )

  it.each(['own', 'ask', 'full-access'] as const)(
    'keeps typed %s when adding, changing or removing GOOSE_MODE',
    (mode) => {
      const settings = {
        agentPermissionDefault: mode,
        agentPermissionOverrides: { codex: 'ask' as const },
        agentDefaultEnv: { goose: { KEEP: '1' }, gemini: { TOKEN: 'latest' } }
      }
      const environments: { current: Record<string, string>; requested: Record<string, string> }[] =
        [
          { current: { KEEP: '1' }, requested: { KEEP: '1', GOOSE_MODE: 'auto' } },
          {
            current: { KEEP: '1', GOOSE_MODE: 'auto' },
            requested: { KEEP: '1', GOOSE_MODE: 'manual' }
          },
          { current: { KEEP: '1', GOOSE_MODE: 'auto' }, requested: { KEEP: '1' } }
        ]
      for (const { current: environment, requested } of environments) {
        const current = {
          ...settings,
          agentDefaultEnv: { ...settings.agentDefaultEnv, goose: environment }
        }
        const updates = wholeAgentEnvironmentUpdates(current, 'goose', requested, 'linux')
        expect(updates).toEqual({
          agentDefaultEnv: { goose: requested, gemini: { TOKEN: 'latest' } }
        })
        expect(resolveAgentPermission('goose', { ...current, ...updates }).choice).toBe(mode)
        expect(updates).not.toHaveProperty('agentPermissionDefault')
        expect(updates).not.toHaveProperty('agentPermissionOverrides')
      }
    }
  )

  it.each(platforms.flatMap((platform) => [20, 200].map((count) => ({ platform, count }))))(
    'bounds changed and unchanged whole env on $platform with $count entries',
    ({ platform, count }) => {
      const extra = Object.fromEntries(
        Array.from({ length: count }, (_, i) => [`K${String(i).padStart(3, '0')}`, 'new'])
      )
      const settings = { agentDefaultEnv: { claude: { Path: 'old' }, gemini: { TOKEN: 'latest' } } }
      const requested = { Path: 'old', PATH: 'new', ...extra }
      const changed = measureSettingsWork(() =>
        wholeAgentEnvironmentUpdates(settings, 'claude', requested, platform)
      )
      expect(changed.value.agentDefaultEnv).toEqual({
        claude: platform === 'win32' ? { PATH: 'new', ...extra } : requested,
        gemini: { TOKEN: 'latest' }
      })
      const latest = { ...settings, ...changed.value }
      const unchanged = measureSettingsWork(() =>
        wholeAgentEnvironmentUpdates(latest, 'claude', requested, platform)
      )
      for (const [kind, measurement, previous] of [
        ['changed', changed, settings],
        ['unchanged', unchanged, latest]
      ] as const) {
        const size =
          Object.keys(previous.agentDefaultEnv?.claude ?? {}).length + Object.keys(requested).length
        const entries = measurement.work.entries + 12 * size
        expect(entries).toBeLessThanOrEqual(36 * size + 64)
        expectSettingsWorkScale(`whole-env-${platform}-${kind}`, count, [
          entries,
          measurement.work.bytes
        ])
      }
      expect(unchanged.value).toEqual({})
    }
  )
})
