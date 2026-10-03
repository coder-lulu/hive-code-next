import { describe, expect, it } from 'vitest'
import {
  deriveNeededSectionIds,
  getInitialMountedSectionIds,
  getPendingSettingsNavigationDisposition,
  shouldLoadSettingsSkillRuntime
} from './settings-load-performance'

describe('Settings load-performance helpers', () => {
  it('keeps only eager and active sections mounted for empty search on first paint', () => {
    const needed = deriveNeededSectionIds({
      navSectionIds: ['general', 'agents', 'appearance', 'terminal', 'stats', 'ssh', 'repo-a'],
      mountedSectionIds: new Set(['general']),
      activeSectionId: 'general',
      pendingSectionId: null,
      query: '',
      visibleSectionIds: new Set([
        'general',
        'agents',
        'appearance',
        'terminal',
        'stats',
        'ssh',
        'repo-a'
      ])
    })

    expect(Array.from(needed).sort()).toEqual(['general'])
  })

  it('keeps search mounting scoped to the active section', () => {
    const needed = deriveNeededSectionIds({
      navSectionIds: ['general', 'agents', 'appearance', 'terminal', 'stats', 'repo-a'],
      mountedSectionIds: new Set(['general']),
      activeSectionId: 'general',
      pendingSectionId: null,
      query: 'stats',
      visibleSectionIds: new Set(['stats'])
    })

    expect(needed.has('stats')).toBe(false)
    expect(needed.has('general')).toBe(false)
  })

  it('mounts the active matched section during search', () => {
    const needed = deriveNeededSectionIds({
      navSectionIds: ['general', 'agents', 'appearance', 'terminal', 'stats', 'repo-a'],
      mountedSectionIds: new Set(['general']),
      activeSectionId: 'stats',
      pendingSectionId: null,
      query: 'stats',
      visibleSectionIds: new Set(['stats'])
    })

    expect(needed.has('stats')).toBe(true)
  })

  it('keeps a pending deep-link target mounted before jump work continues', () => {
    const needed = deriveNeededSectionIds({
      navSectionIds: ['general', 'agents', 'appearance', 'terminal', 'repo-a'],
      mountedSectionIds: new Set(['general']),
      activeSectionId: 'general',
      pendingSectionId: 'repo-a',
      query: '',
      visibleSectionIds: new Set(['general', 'agents', 'appearance', 'terminal', 'repo-a'])
    })

    expect(needed.has('repo-a')).toBe(true)
  })

  it('lets a pending non-general deep link supersede the default general section', () => {
    const needed = deriveNeededSectionIds({
      navSectionIds: ['general', 'orca-account', 'appearance'],
      mountedSectionIds: getInitialMountedSectionIds('orca-account'),
      activeSectionId: 'general',
      pendingSectionId: 'orca-account',
      query: '',
      visibleSectionIds: new Set(['general', 'orca-account', 'appearance'])
    })

    expect(Array.from(needed)).toEqual(['orca-account'])
  })

  it.each([
    ['a desktop-only account target on web', 'orca-account'],
    ['a disconnected Linear target', 'linear'],
    ['a stale repository target', 'repo-removed']
  ])('keeps General mounted for %s', (_label, pendingSectionId) => {
    const navSectionIds = ['general', 'appearance']
    const visibleSectionIds = new Set(navSectionIds)

    expect(
      getPendingSettingsNavigationDisposition({
        pendingSectionId,
        navSectionIds,
        query: '',
        visibleSectionIds
      })
    ).toBe('invalid')
    expect(
      Array.from(
        deriveNeededSectionIds({
          navSectionIds,
          mountedSectionIds: new Set(['general', pendingSectionId]),
          activeSectionId: 'general',
          pendingSectionId,
          query: '',
          visibleSectionIds
        })
      )
    ).toEqual(['general'])
  })

  it('clears a search filter before following a valid hidden deep link', () => {
    const navSectionIds = ['general', 'appearance']
    const visibleSectionIds = new Set(['general'])

    expect(
      getPendingSettingsNavigationDisposition({
        pendingSectionId: 'appearance',
        navSectionIds,
        query: 'general',
        visibleSectionIds
      })
    ).toBe('clear-search')
    expect(
      deriveNeededSectionIds({
        navSectionIds,
        mountedSectionIds: new Set(['general']),
        activeSectionId: 'general',
        pendingSectionId: 'appearance',
        query: 'general',
        visibleSectionIds
      }).has('appearance')
    ).toBe(false)
  })

  it('keeps the default general section eager for normal entry and general deep links', () => {
    expect(Array.from(getInitialMountedSectionIds())).toEqual(['general'])
    expect(Array.from(getInitialMountedSectionIds('general'))).toEqual(['general'])
  })

  it('does not load general after a non-general deep link settles until it is selected', () => {
    const needed = deriveNeededSectionIds({
      navSectionIds: ['general', 'orca-account', 'appearance'],
      mountedSectionIds: new Set(['orca-account']),
      activeSectionId: 'orca-account',
      pendingSectionId: null,
      query: '',
      visibleSectionIds: new Set(['general', 'orca-account', 'appearance'])
    })

    expect(Array.from(needed)).toEqual(['orca-account'])
  })

  it('only probes the active project skill runtime for sections that consume it', () => {
    expect(shouldLoadSettingsSkillRuntime(new Set(['general', 'orca-account']))).toBe(false)
    expect(shouldLoadSettingsSkillRuntime(new Set(['agent-capabilities']))).toBe(true)
    expect(shouldLoadSettingsSkillRuntime(new Set(['linear']))).toBe(true)
    expect(shouldLoadSettingsSkillRuntime(new Set(['computer-use']))).toBe(false)
  })
})
