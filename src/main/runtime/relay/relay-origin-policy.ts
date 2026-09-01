export function isCanonicalHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.origin === value
  } catch {
    return false
  }
}

export function isCanonicalDirectorOrigin(value: string): boolean {
  try {
    const url = new URL(value)
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    return (
      url.origin === value && (url.protocol === 'https:' || (url.protocol === 'http:' && loopback))
    )
  } catch {
    return false
  }
}

export function isProbeOriginForDirector(origin: string, directorUrl: string): boolean {
  return new URL(origin).hostname.endsWith(`.${new URL(directorUrl).hostname}`)
}
