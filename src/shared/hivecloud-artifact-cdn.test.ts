import { describe, expect, it } from 'vitest'
import { isHiveCloudArtifactCdnUrl } from './hivecloud-artifact-cdn'

const origin = 'https://oss.cloud.hivekernel.com'
const now = 1_800_000_000
const signed = `${origin}/releases/windows/HiveCode%20Setup.exe?e=${now + 600}&token=test:signature_123%3D`

describe('short-lived release CDN capabilities', () => {
  it('accepts an encoded object path with the configured HTTPS origin', () => {
    expect(isHiveCloudArtifactCdnUrl(signed, origin, now)).toBe(true)
  })
  it.each([
    signed.replace('https:', 'http:'),
    signed.replace('oss.cloud.hivekernel.com', 'oss.cloud.hivekernel.com.attacker.test'),
    signed.replace('/releases/', '/metadata/'),
    signed.replace('/windows/', '/windows%2f'),
    signed.replace('/windows/', '/windows%5c'),
    signed.replace(String(now + 600), String(now)),
    signed.replace(String(now + 600), String(now + 3601)),
    signed.replace('token=test:', 'token='),
    `${signed}&e=${now + 600}`,
    `${signed}&attname=setup.exe`,
    `${signed}#fragment`,
    signed.replace('https://', 'https://user:pass@')
  ])('rejects invalid capability %s', (url) => {
    expect(isHiveCloudArtifactCdnUrl(url, origin, now)).toBe(false)
  })
  it.each([
    null,
    `${origin}/path`,
    `${origin}?query`,
    `${origin}#fragment`,
    'http://oss.cloud.hivekernel.com'
  ])('rejects an invalid configured origin %s', (configured) => {
    expect(isHiveCloudArtifactCdnUrl(signed, configured, now)).toBe(false)
  })
})
