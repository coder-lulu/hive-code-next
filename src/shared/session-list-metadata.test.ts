import { describe, expect, it } from 'vitest'
import { normalizeSessionListMetadata, partitionSessionList } from './session-list-metadata'

describe('session list organization', () => {
  const inventory = [{ key: 'host-a:one' }, { key: 'host-b:one' }, { key: 'host-a:two' }]
  it('pins within each group without mutating inventory or conflating hosts', () => {
    const groups = partitionSessionList(inventory, {
      'host-b:one': { pinned: true },
      'host-a:two': { archived: true, pinned: true }
    })
    expect(groups.active).toEqual([inventory[1], inventory[0]])
    expect(groups.archived).toEqual([inventory[2]])
    expect(inventory.map((item) => item.key)).toEqual(['host-a:one', 'host-b:one', 'host-a:two'])
  })
  it('retains an archived-only result and honors an already filtered inventory', () => {
    const metadata = { 'host-a:one': { archived: true }, 'host-b:one': { pinned: true } }
    expect(partitionSessionList([inventory[0]], metadata)).toEqual({
      active: [],
      archived: [inventory[0]]
    })
  })
  it('normalizes stored values, drops cleared flags, and preserves archive when unpinning', () => {
    expect(
      normalizeSessionListMetadata({
        one: { pinned: false, archived: true },
        two: { pinned: false },
        bad: 'true',
        wrong: { archived: 'true' }
      })
    ).toEqual({ one: { archived: true } })
    expect(normalizeSessionListMetadata(null)).toEqual({})
    expect(normalizeSessionListMetadata([])).toEqual({})
  })
})
