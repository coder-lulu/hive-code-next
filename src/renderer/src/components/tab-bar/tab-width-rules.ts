// Why: the strip shrink-wraps its tabs, so a content-derived width lets one live title update
// resize every tab; a definite width pins them and flex-shrink still narrows to the floor.
export const TAB_CONTAINER_WIDTH_CLASSES =
  'tab-container w-[var(--tab-width)] min-w-[var(--tab-min-width)] min-[1280px]:w-[var(--tab-width-wide)]'

export const TAB_LABEL_WIDTH_CLASSES = 'min-w-0 flex-1 truncate'
