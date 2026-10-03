/** A short-lived Qiniu capability is accepted only after the immutable artifact gateway redirects. */
export function isHiveCloudArtifactCdnUrl(
  value: string,
  configuredOrigin: string | null,
  nowSeconds = Math.floor(Date.now() / 1000)
): boolean {
  try {
    const url = new URL(value)
    const origin = new URL(configuredOrigin ?? '')
    const entries = [...url.searchParams.entries()]
    const expires = url.searchParams.get('e') ?? ''
    return (
      origin.protocol === 'https:' &&
      origin.pathname === '/' &&
      !origin.search &&
      !origin.hash &&
      !origin.username &&
      !origin.password &&
      url.origin === origin.origin &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.pathname.startsWith('/releases/') &&
      !/%(?:2f|5c|00)/i.test(url.pathname) &&
      !url.pathname.includes('\\') &&
      entries.length === 2 &&
      entries.some(([key]) => key === 'e') &&
      entries.some(([key]) => key === 'token') &&
      /^\d{1,12}$/.test(expires) &&
      Number(expires) > nowSeconds &&
      Number(expires) <= nowSeconds + 3600 &&
      /^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+={0,2}$/.test(url.searchParams.get('token') ?? '')
    )
  } catch {
    return false
  }
}
