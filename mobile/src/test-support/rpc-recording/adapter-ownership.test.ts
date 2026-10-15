import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { adapterSourceByOperation } from './adapter-digest'
import { MOUNTED_OPERATION_MODULES } from './adapters/mounted-operation-modules'
import { RECORDING_ADAPTER_OWNERS } from '../../../../config/scripts/upstream-recording-adapters.mjs'

const root = resolve(import.meta.dirname, '../../../..')
describe('complete trusted adapter ownership', () => {
  it('matches every live factory operation and source', () => {
    expect(Object.fromEntries(adapterSourceByOperation(root))).toEqual(RECORDING_ADAPTER_OWNERS)
  })
  it('rejects duplicate factories instead of overwriting ownership', () => {
    expect(() =>
      adapterSourceByOperation(root, [...MOUNTED_OPERATION_MODULES, MOUNTED_OPERATION_MODULES[0]!])
    ).toThrow('Duplicate adapter operation')
  })
  it('rejects a missing factory and a changed source', () => {
    expect(() => adapterSourceByOperation(root, MOUNTED_OPERATION_MODULES.slice(1))).toThrow(
      'complete frozen ownership'
    )
    expect(() =>
      adapterSourceByOperation(
        root,
        MOUNTED_OPERATION_MODULES.map((module, index) =>
          index ? module : { ...module, source: 'unreviewed.ts' }
        )
      )
    ).toThrow('complete frozen ownership')
  })
  it('rejects an extra operation even when its factory remains registered', () => {
    const first = MOUNTED_OPERATION_MODULES[0]!
    const changed = {
      ...first,
      mounts: (...args: Parameters<typeof first.mounts>) => {
        const actual = first.mounts(...args)
        return { ...actual, 'unreviewed.operation': Object.values(actual)[0]! }
      }
    }
    expect(() =>
      adapterSourceByOperation(root, [changed, ...MOUNTED_OPERATION_MODULES.slice(1)])
    ).toThrow('complete frozen ownership')
    expect(Object.isFrozen(RECORDING_ADAPTER_OWNERS)).toBe(true)
  })
})
