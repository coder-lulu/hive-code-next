const EAGER_SECTION_IDS = new Set(['general'])
const SKILL_RUNTIME_SECTION_IDS = new Set(['orchestration', 'linear', 'computer-use'])

export function getPendingSettingsNavigationDisposition(args: {
  pendingSectionId: string | null
  navSectionIds: readonly string[]
  query: string
  visibleSectionIds: ReadonlySet<string>
}): 'none' | 'invalid' | 'clear-search' | 'ready' {
  if (!args.pendingSectionId) {
    return 'none'
  }
  if (!args.navSectionIds.includes(args.pendingSectionId)) {
    return 'invalid'
  }
  if (args.visibleSectionIds.has(args.pendingSectionId)) {
    return 'ready'
  }
  return args.query.trim() === '' ? 'invalid' : 'clear-search'
}

export function deriveNeededSectionIds(args: {
  navSectionIds: string[]
  mountedSectionIds: Set<string>
  activeSectionId: string | null
  pendingSectionId: string | null
  query: string
  visibleSectionIds: Set<string>
}): Set<string> {
  const hasSearchQuery = args.query.trim() !== ''
  const availableSectionIds = new Set(args.navSectionIds)
  const pendingDisposition = getPendingSettingsNavigationDisposition(args)
  const pendingSectionIsReady = pendingDisposition === 'ready'
  const pendingSectionSupersedesActive =
    pendingSectionIsReady && args.pendingSectionId !== args.activeSectionId
  const next = hasSearchQuery
    ? new Set<string>()
    : new Set([...args.mountedSectionIds].filter((id) => availableSectionIds.has(id)))
  if (!hasSearchQuery) {
    for (const sectionId of args.navSectionIds) {
      if (
        EAGER_SECTION_IDS.has(sectionId) &&
        sectionId === args.activeSectionId &&
        !pendingSectionSupersedesActive
      ) {
        next.add(sectionId)
      }
    }
  }
  if (
    args.activeSectionId &&
    availableSectionIds.has(args.activeSectionId) &&
    !pendingSectionSupersedesActive &&
    (!hasSearchQuery || args.visibleSectionIds.has(args.activeSectionId))
  ) {
    next.add(args.activeSectionId)
  }
  if (args.pendingSectionId && pendingSectionIsReady) {
    next.add(args.pendingSectionId)
  }
  return next
}

export function getInitialMountedSectionIds(initialSectionId: string | null = null): Set<string> {
  if (initialSectionId && !EAGER_SECTION_IDS.has(initialSectionId)) {
    return new Set([initialSectionId])
  }
  return new Set(EAGER_SECTION_IDS)
}

export function shouldLoadSettingsSkillRuntime(mountedSectionIds: ReadonlySet<string>): boolean {
  for (const sectionId of mountedSectionIds) {
    if (SKILL_RUNTIME_SECTION_IDS.has(sectionId)) {
      return true
    }
  }
  return false
}
