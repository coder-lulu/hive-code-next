export function normalizeHiveRuntimeCloudAuthorityId(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_hive_runtime_cloud_capabilities_response')
  }
  const authorityId = (value as Record<string, unknown>).authorityId
  const hasControlCharacter =
    typeof authorityId === 'string' &&
    Array.from(authorityId).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint <= 0x1f || codePoint === 0x7f
    })
  if (
    typeof authorityId !== 'string' ||
    authorityId.length < 1 ||
    authorityId.length > 128 ||
    hasControlCharacter
  ) {
    throw new Error('invalid_hive_runtime_cloud_capabilities_response')
  }
  return authorityId
}
