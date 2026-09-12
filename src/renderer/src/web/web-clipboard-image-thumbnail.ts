import {
  assertClipboardImageByteLengthWithinLimit,
  assertClipboardImageDimensionsWithinLimit,
  clipboardImageThumbnailSize,
  type ClipboardImageThumbnail
} from '../../../shared/clipboard-image'

async function readClipboardImageBlob(): Promise<Blob | null> {
  const clipboard = navigator.clipboard as
    | (Clipboard & { read?: () => Promise<ClipboardItem[]> })
    | undefined
  if (!clipboard?.read) {
    return null
  }
  const items = await clipboard.read()
  for (const item of items) {
    const imageType = item.types.find((type) => type.startsWith('image/'))
    if (imageType) {
      return item.getType(imageType)
    }
  }
  return null
}

/** Web counterpart of the main-process clipboard probe: decodes the clipboard
 *  image once and returns a small preview so the composer can show a chip while
 *  the full image is still being uploaded to the runtime. */
export async function readClipboardImageThumbnail(): Promise<ClipboardImageThumbnail | null> {
  const blob = await readClipboardImageBlob()
  if (!blob) {
    return null
  }
  assertClipboardImageByteLengthWithinLimit(blob.size)
  const bitmap = await createImageBitmap(blob)
  try {
    assertClipboardImageDimensionsWithinLimit(bitmap)
    const thumbnailSize = clipboardImageThumbnailSize(bitmap)
    const canvas = document.createElement('canvas')
    canvas.width = thumbnailSize.width
    canvas.height = thumbnailSize.height
    const context = canvas.getContext('2d')
    if (!context) {
      return null
    }
    context.drawImage(bitmap, 0, 0, thumbnailSize.width, thumbnailSize.height)
    return { dataUrl: canvas.toDataURL('image/png'), height: bitmap.height, width: bitmap.width }
  } finally {
    bitmap.close()
  }
}
