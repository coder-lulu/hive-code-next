export const HIVE_RUNTIME_DISPLAY_NAME_MAX_CODE_POINTS = 128

export class HiveRuntimeDisplayNameError extends Error {
  constructor(readonly code: 'EMPTY' | 'TOO_LONG' | 'UNSAFE_TEXT') {
    super('hive_runtime_display_name_invalid')
    this.name = 'HiveRuntimeDisplayNameError'
  }
}

export function normalizeHiveRuntimeDisplayName(value: string): string {
  const normalized = value.trim().normalize('NFC')
  if (!normalized) {
    throw new HiveRuntimeDisplayNameError('EMPTY')
  }
  if (hasUnpairedUtf16Surrogate(normalized)) {
    throw new HiveRuntimeDisplayNameError('UNSAFE_TEXT')
  }
  if (Array.from(normalized).length > HIVE_RUNTIME_DISPLAY_NAME_MAX_CODE_POINTS) {
    throw new HiveRuntimeDisplayNameError('TOO_LONG')
  }
  if (hasUnsafeDisplayNameCodePoint(normalized)) {
    throw new HiveRuntimeDisplayNameError('UNSAFE_TEXT')
  }
  return normalized
}

function hasUnpairedUtf16Surrogate(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) {
        return true
      }
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) {
        return true
      }
      index += 1
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true
    }
  }
  return false
}

function hasUnsafeDisplayNameCodePoint(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x061c ||
      codePoint === 0x200e ||
      codePoint === 0x200f ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x206f)
    )
  })
}

export function isNormalizedHiveRuntimeDisplayName(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }
  try {
    return normalizeHiveRuntimeDisplayName(value) === value
  } catch {
    return false
  }
}

type RuntimeDisplayNameSources = Readonly<{
  pendingDesiredName?: string | null
  cloudDisplayName?: string | null
  localPairedName?: string | null
  reportedDeviceName?: string | null
  runtimeRecordId: string
}>

export function resolveHiveRuntimeDisplayName(sources: RuntimeDisplayNameSources): string {
  if (sources.pendingDesiredName !== undefined) {
    if (sources.pendingDesiredName) {
      return sources.pendingDesiredName
    }
  } else if (sources.cloudDisplayName) {
    return sources.cloudDisplayName
  }
  return (
    sources.localPairedName?.trim() ||
    sources.reportedDeviceName?.trim() ||
    `Runtime ${sources.runtimeRecordId.slice(0, 8)}`
  )
}
