import { describe, expect, it } from 'vitest'
import { resolveProductUpdateFeedUrl, resolveProductUpdateSource } from './product-update-source'

const config = (
  updateChannel: string | null,
  updateEndpoint: string | null,
  updateRepository: string | null = 'coder-lulu/hive-code',
  updateProvider: string | null = 'github'
): Parameters<typeof resolveProductUpdateSource>[0] => ({
  desktop: { updateChannel, updateProvider, updateRepository },
  endpoints: { update: updateEndpoint }
})

describe('resolveProductUpdateSource', () => {
  it.each([
    [
      null,
      'https://github.com/coder-lulu/hive-code/releases/latest/download',
      'coder-lulu/hive-code',
      'github'
    ],
    ['stable', null, 'coder-lulu/hive-code', 'github'],
    [
      'stable',
      'https://github.com/coder-lulu/hive-code/releases/latest/download',
      'coder-lulu/hive-code',
      null
    ],
    [
      '',
      'https://github.com/coder-lulu/hive-code/releases/latest/download',
      'coder-lulu/hive-code',
      'github'
    ],
    ['stable', 'https://github.com/coder-lulu/hive-code/releases/latest/download', null, 'github']
  ])(
    'fails closed when channel, endpoint, or repository is not configured',
    (channel, endpoint, repository, provider) => {
      expect(resolveProductUpdateSource(config(channel, endpoint, repository, provider))).toBeNull()
    }
  )

  it('derives every GitHub release URL from the configured product repository', () => {
    expect(
      resolveProductUpdateSource(
        config('stable', 'https://github.com/coder-lulu/hive-code/releases/latest/download')
      )
    ).toEqual({
      channel: 'stable',
      feedUrl: 'https://github.com/coder-lulu/hive-code/releases/latest/download',
      github: {
        repo: 'coder-lulu/hive-code',
        atomFeedUrl: 'https://github.com/coder-lulu/hive-code/releases.atom',
        releasesDownloadBase: 'https://github.com/coder-lulu/hive-code/releases/download',
        releasesApiUrl: 'https://api.github.com/repos/coder-lulu/hive-code/releases'
      },
      provider: 'github'
    })
  })

  it('resolves an explicit HiveCloud generic feed without GitHub metadata', () => {
    expect(
      resolveProductUpdateSource(
        config(
          'stable',
          'https://updates.hivekernel.example/hive/v1/updates/desktop/',
          null,
          'hivecloud'
        )
      )
    ).toEqual({
      channel: 'stable',
      feedUrl: 'https://updates.hivekernel.example/hive/v1/updates/desktop/',
      github: null,
      provider: 'hivecloud'
    })
  })

  it('maps the HiveCloud beta channel to the matching server feed', () => {
    const source = resolveProductUpdateSource(
      config(
        'beta',
        'https://updates.hivekernel.example/hive/v1/updates/desktop/',
        null,
        'hivecloud'
      )
    )

    expect(source && resolveProductUpdateFeedUrl(source, 'win32', 'x64')).toBe(
      'https://updates.hivekernel.example/hive/v1/updates/desktop/beta/windows/x64/'
    )
  })

  it.each([
    ['win32', 'x64', 'stable/windows/x64/'],
    ['darwin', 'arm64', 'stable/macos/arm64/'],
    ['linux', 'x64', 'stable/linux/x64/']
  ] as const)('builds the HiveCloud feed for %s/%s', (platform, arch, suffix) => {
    const source = resolveProductUpdateSource(
      config(
        'stable',
        'https://updates.hivekernel.example/hive/v1/updates/desktop/',
        null,
        'hivecloud'
      )
    )

    expect(source && resolveProductUpdateFeedUrl(source, platform, arch)).toBe(
      `https://updates.hivekernel.example/hive/v1/updates/desktop/${suffix}`
    )
  })

  it.each([
    ['freebsd', 'x64'],
    ['win32', 'ia32'],
    ['linux', 'riscv64']
  ] as const)('fails closed for unsupported HiveCloud target %s/%s', (platform, arch) => {
    const source = resolveProductUpdateSource(
      config(
        'stable',
        'https://updates.hivekernel.example/hive/v1/updates/desktop/',
        null,
        'hivecloud'
      )
    )

    expect(source && resolveProductUpdateFeedUrl(source, platform, arch)).toBeNull()
  })

  it.each([
    'https://downloads.example.com/product-update/stable/',
    'https://github.com:444/coder-lulu/hive-code/releases/latest/download',
    'https://github.com/coder-lulu/hive-code/releases/latest/%64ownload',
    'https://github.com/coder%2Flulu/hive-code/releases/latest/download',
    'https://github.com/coder-lulu/hive%2Fcode/releases/latest/download'
  ])('fails closed for unsupported or non-canonical update endpoint %s', (endpoint) => {
    expect(resolveProductUpdateSource(config('stable', endpoint))).toBeNull()
  })

  it.each([
    'https://updates.hivekernel.example/hive/v1/updates/desktop',
    'https://updates.hivekernel.example/hive/v1/updates/desktop/beta/',
    'https://github.com/coder-lulu/hive-code/releases/latest/download'
  ])('fails closed for a non-canonical HiveCloud update endpoint %s', (endpoint) => {
    expect(resolveProductUpdateSource(config('stable', endpoint, null, 'hivecloud'))).toBeNull()
  })

  it.each([
    'http://updates.hivekernel.example/hive/v1/updates/desktop/',
    'https://user:secret@updates.hivekernel.example/hive/v1/updates/desktop/',
    'https://updates.hivekernel.example/hive/v1/updates/desktop/?token=secret',
    'https://updates.hivekernel.example/hive/v1/updates/desktop/#latest'
  ])('fails closed for an unsafe HiveCloud update endpoint %s', (endpoint) => {
    expect(resolveProductUpdateSource(config('stable', endpoint, null, 'hivecloud'))).toBeNull()
  })

  it('fails closed instead of using a configured repository as a HiveCloud fallback', () => {
    expect(
      resolveProductUpdateSource(
        config(
          'stable',
          'https://updates.hivekernel.example/hive/v1/updates/desktop/',
          'stablyai/orca',
          'hivecloud'
        )
      )
    ).toBeNull()
  })

  it.each([
    'http://downloads.example.com/product-update/stable/',
    'https://user:secret@downloads.example.com/product-update/stable/',
    'https://downloads.example.com/product-update/stable/?token=secret',
    'https://downloads.example.com/product-update/stable/#fragment'
  ])('fails closed for unsafe update endpoint %s', (endpoint) => {
    expect(resolveProductUpdateSource(config('stable', endpoint))).toBeNull()
  })

  it.each(['hourly', 'adhoc', 'STABLE'])(
    'fails closed for unsupported product update channel %s',
    (channel) => {
      expect(
        resolveProductUpdateSource(
          config(channel, 'https://github.com/coder-lulu/hive-code/releases/latest/download')
        )
      ).toBeNull()
    }
  )

  it.each([
    ['https://github.com/stablyai/orca/releases/latest/download', 'coder-lulu/hive-code'],
    ['https://github.com/coder-lulu/hive-code/releases/latest/download', 'coder-lulu/other-repo'],
    [
      'https://github.com/coder-lulu/hive-code/releases/latest/download',
      'coder-lulu/hive-code/releases'
    ],
    ['https://github.com/coder-lulu/hive-code/releases/latest/download', 'https://github.com/x/y']
  ])(
    'fails closed when endpoint %s does not match approved repository %s',
    (endpoint, repository) => {
      expect(resolveProductUpdateSource(config('stable', endpoint, repository))).toBeNull()
    }
  )
})
