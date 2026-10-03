export function isCanonicalHiveRelayOrigin(value: string): boolean {
  const matched = /^https:\/\/([^/?#@]+)$/.exec(value)
  if (!matched) {
    return false
  }
  const authority = matched[1]
  if (!authority || authority.includes('[') || authority.includes(']')) {
    return false
  }
  const separator = authority.lastIndexOf(':')
  const host = separator === -1 ? authority : authority.slice(0, separator)
  const portText = separator === -1 ? null : authority.slice(separator + 1)
  if (
    !host ||
    host.length > 253 ||
    host !== host.toLowerCase() ||
    [...host].some((character) => character.charCodeAt(0) > 0x7f)
  ) {
    return false
  }
  if (portText !== null) {
    if (!/^[0-9]{1,5}$/.test(portText)) {
      return false
    }
    const port = Number(portText)
    if (port < 1 || port > 65_535 || port === 443 || String(port) !== portText) {
      return false
    }
  }
  const labels = host.split('.')
  if (
    labels.length === 4 &&
    labels.every((label) => /^(?:0|[1-9][0-9]{0,2})$/.test(label) && Number(label) <= 255)
  ) {
    return false
  }
  return labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
}
