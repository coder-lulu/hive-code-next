// Definite widths prevent live titles from resizing the strip; flex-shrink still allows narrowing to the minimum.
export const TAB_CONTAINER_WIDTH_CLASSES =
  'tab-container w-[var(--tab-width)] min-w-[var(--tab-min-width)] min-[1280px]:w-[var(--tab-width-wide)]'

export const TAB_LABEL_WIDTH_CLASSES = 'min-w-0 flex-1 truncate'
