import { describe, expect, it } from 'vitest'
import { hasConfiguredProductUpdateChannel } from './product-update-policy'

function config(
  updateChannel: string | null,
  updateEndpoint: string | null,
  updateRepository: string | null = 'coder-lulu/hive-code',
  updateProvider: string | null = 'github'
) {
  return {
    desktop: { updateChannel, updateProvider, updateRepository },
    endpoints: { update: updateEndpoint }
  } as never
}

describe('product update policy', () => {
  it('keeps release updates disabled for the approved null configuration', () => {
    expect(hasConfiguredProductUpdateChannel()).toBe(false)
  })

  it('requires both an approved channel and a HiveCode update endpoint', () => {
    expect(hasConfiguredProductUpdateChannel(config('stable', null))).toBe(false)
    expect(hasConfiguredProductUpdateChannel(config(null, 'https://update.hivekernel.com'))).toBe(
      false
    )
    expect(
      hasConfiguredProductUpdateChannel(
        config('stable', 'https://github.com/coder-lulu/hive-code/releases/latest/download')
      )
    ).toBe(true)
  })

  it('accepts an explicit HiveCloud generic source without a GitHub repository', () => {
    expect(
      hasConfiguredProductUpdateChannel(
        config(
          'stable',
          'https://updates.hivekernel.example/hive/v1/updates/desktop/',
          null,
          'hivecloud'
        )
      )
    ).toBe(true)
  })

  it('rejects an update endpoint that contains credentials', () => {
    expect(
      hasConfiguredProductUpdateChannel(
        config(
          'stable',
          'https://user:secret@github.com/coder-lulu/hive-code/releases/latest/download'
        )
      )
    ).toBe(false)
  })
})
