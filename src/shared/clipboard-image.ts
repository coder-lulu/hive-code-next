export const CLIPBOARD_IMAGE_MAX_BASE64_CHARS = 24 * 1024 * 1024
export const CLIPBOARD_IMAGE_MAX_SOURCE_BYTES = Math.floor(
  (CLIPBOARD_IMAGE_MAX_BASE64_CHARS / 4) * 3
)
export const CLIPBOARD_IMAGE_MAX_PIXELS = 32 * 1024 * 1024
export const CLIPBOARD_IMAGE_TOO_LARGE_ERROR = 'Clipboard image is too large'

/** Prefix used for clipboard images staged in the local or remote temp dir. */
export const CLIPBOARD_IMAGE_TEMP_FILE_PREFIX = 'hivecode-paste'

/**
 * Legacy prefix kept for reading paths persisted by older HiveCode builds.
 * New files must always use CLIPBOARD_IMAGE_TEMP_FILE_PREFIX.
 */
export const LEGACY_CLIPBOARD_IMAGE_TEMP_FILE_PREFIX = 'orca-paste'

export function isClipboardImageTempFileName(fileName: string): boolean {
  return new RegExp(
    `^(?:${CLIPBOARD_IMAGE_TEMP_FILE_PREFIX}|${LEGACY_CLIPBOARD_IMAGE_TEMP_FILE_PREFIX})-.+\\.png$`,
    'i'
  ).test(fileName)
}

export type ClipboardImageDimensions = {
  height: number
  width: number
}

export function assertClipboardImageBase64LengthWithinLimit(length: number): void {
  if (!Number.isFinite(length) || length > CLIPBOARD_IMAGE_MAX_BASE64_CHARS) {
    throw new Error(CLIPBOARD_IMAGE_TOO_LARGE_ERROR)
  }
}

export function assertClipboardImageByteLengthWithinLimit(byteLength: number): void {
  if (!Number.isFinite(byteLength) || byteLength > CLIPBOARD_IMAGE_MAX_SOURCE_BYTES) {
    throw new Error(CLIPBOARD_IMAGE_TOO_LARGE_ERROR)
  }
}

export function assertClipboardImageDimensionsWithinLimit({
  height,
  width
}: ClipboardImageDimensions): void {
  const pixelCount = width * height
  if (
    !Number.isFinite(pixelCount) ||
    width <= 0 ||
    height <= 0 ||
    pixelCount > CLIPBOARD_IMAGE_MAX_PIXELS
  ) {
    throw new Error(CLIPBOARD_IMAGE_TOO_LARGE_ERROR)
  }
}

/** Longest edge of the thumbnail the composer shows while the full clipboard
 *  image is still being written to disk. Small enough to cross IPC instantly. */
export const CLIPBOARD_IMAGE_THUMBNAIL_MAX_EDGE = 320

export type ClipboardImageThumbnail = ClipboardImageDimensions & {
  /** `data:image/png;base64,...` preview of the clipboard image. */
  dataUrl: string
}

/** Scale `size` down so its longest edge fits the thumbnail budget. Returns the
 *  input unchanged when it already fits, so small images skip the resize. */
export function clipboardImageThumbnailSize({
  height,
  width
}: ClipboardImageDimensions): ClipboardImageDimensions {
  const longestEdge = Math.max(width, height)
  if (longestEdge <= CLIPBOARD_IMAGE_THUMBNAIL_MAX_EDGE) {
    return { height, width }
  }
  const scale = CLIPBOARD_IMAGE_THUMBNAIL_MAX_EDGE / longestEdge
  return {
    height: Math.max(1, Math.round(height * scale)),
    width: Math.max(1, Math.round(width * scale))
  }
}
