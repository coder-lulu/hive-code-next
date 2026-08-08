import type { OutgoingHttpHeaders } from 'node:http'

const SAFE_CROSS_ORIGIN_HEADER_NAMES = new Set([
  'accept',
  'accept-encoding',
  'cache-control',
  'pragma',
  'user-agent'
])

export function sanitizeCrossOriginHeaders(
  headers: OutgoingHttpHeaders | readonly string[] | undefined
): OutgoingHttpHeaders {
  const safe: OutgoingHttpHeaders = {}
  if (Array.isArray(headers)) {
    for (let index = 0; index + 1 < headers.length; index += 2) {
      if (SAFE_CROSS_ORIGIN_HEADER_NAMES.has(headers[index].toLowerCase())) {
        safe[headers[index]] = headers[index + 1]
      }
    }
    return safe
  }
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (SAFE_CROSS_ORIGIN_HEADER_NAMES.has(name.toLowerCase())) {
      safe[name] = value
    }
  }
  return safe
}

export function stripUnsafeCrossOriginHeaders(headers: Headers): void {
  for (const name of Array.from(headers.keys())) {
    if (!SAFE_CROSS_ORIGIN_HEADER_NAMES.has(name.toLowerCase())) {
      headers.delete(name)
    }
  }
}

export function toFetchHeaders(
  headers: OutgoingHttpHeaders | readonly string[] | undefined
): Headers {
  const result = new Headers()
  if (Array.isArray(headers)) {
    for (let index = 0; index + 1 < headers.length; index += 2) {
      result.append(headers[index], headers[index + 1])
    }
    return result
  }
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (value === undefined) {
      continue
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        result.append(name, item)
      }
    } else {
      result.set(name, String(value))
    }
  }
  return result
}
