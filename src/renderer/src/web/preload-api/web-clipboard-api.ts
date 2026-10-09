export { readClipboardImageThumbnail } from '../web-clipboard-image-thumbnail'
import {
  CLIPBOARD_IMAGE_MAX_BASE64_CHARS,
  CLIPBOARD_IMAGE_MAX_PIXELS,
  CLIPBOARD_IMAGE_MAX_SOURCE_BYTES,
  CLIPBOARD_IMAGE_TOO_LARGE_ERROR,
  assertClipboardImageByteLengthWithinLimit,
  clipboardFormatsIncludeImage
} from '../../../../shared/clipboard-image'
import { assertClipboardTextWriteWithinLimitWithYield } from '../../../../shared/clipboard-text'
import { blobToBase64, convertImageBlobToPng } from '@/lib/image-blob-png'
import { copyClipboardTextViaExecCommand } from '../web-clipboard-copy-fallback'
import { callRuntimeEnvelope, callRuntimeResult } from './web-runtime-calls'

export const MAX_CLIPBOARD_IMAGE_BASE64_CHARS = CLIPBOARD_IMAGE_MAX_BASE64_CHARS

export const MAX_CLIPBOARD_IMAGE_SOURCE_BYTES = CLIPBOARD_IMAGE_MAX_SOURCE_BYTES

export const MAX_CLIPBOARD_IMAGE_PIXELS = CLIPBOARD_IMAGE_MAX_PIXELS

export const CLIPBOARD_IMAGE_UPLOAD_CHUNK_BASE64_CHARS = 512 * 1024

export const CLIPBOARD_IMAGE_SINGLE_FRAME_FALLBACK_BASE64_CHARS = 256 * 1024

export const CLIPBOARD_IMAGE_SAVE_TIMEOUT_MS = 30_000

export function assertClipboardImageBlobWithinLimit(blob: Blob): void {
  assertClipboardImageByteLengthWithinLimit(blob.size)
}

export async function readClipboardImagePngBase64(): Promise<string | null> {
  const clipboard = navigator.clipboard as
    | (Clipboard & { read?: () => Promise<ClipboardItem[]> })
    | undefined
  if (!clipboard?.read) {
    return null
  }
  const items = await clipboard.read()
  for (const item of items) {
    const imageType = item.types.find((type) => type.startsWith('image/'))
    if (!imageType) {
      continue
    }
    const blob = await item.getType(imageType)
    assertClipboardImageBlobWithinLimit(blob)
    const pngBlob = imageType === 'image/png' ? blob : await convertImageBlobToPng(blob)
    return blobToBase64(pngBlob)
  }
  return null
}

export async function writeWebClipboardText(text: string): Promise<void> {
  await assertClipboardTextWriteWithinLimitWithYield(text)
  const clipboard = navigator.clipboard
  if (typeof clipboard?.writeText === 'function') {
    try {
      await clipboard.writeText(text)
      return
    } catch (error) {
      // Preserve the current user-activation turn for the synchronous fallback.
      if (copyClipboardTextViaExecCommand(text)) {
        return
      }
      throw error
    }
  }
  if (!copyClipboardTextViaExecCommand(text)) {
    throw new Error('Clipboard write is unavailable in this browser context')
  }
}

export async function saveClipboardImageAsTempFileInRuntime(
  contentBase64: string,
  args?: { connectionId?: string | null; runtimeEnvironmentId?: string | null }
): Promise<string> {
  if (contentBase64.length > MAX_CLIPBOARD_IMAGE_BASE64_CHARS) {
    throw new Error(CLIPBOARD_IMAGE_TOO_LARGE_ERROR)
  }
  const connectionId = args?.connectionId ?? null
  const startResponse = await callRuntimeEnvelope<{ uploadId: string }>(
    'clipboard.startImageUpload',
    { expectedBase64Length: contentBase64.length, connectionId },
    CLIPBOARD_IMAGE_SAVE_TIMEOUT_MS
  )
  if (!startResponse.ok) {
    if (
      startResponse.error.code === 'method_not_found' &&
      contentBase64.length <= CLIPBOARD_IMAGE_SINGLE_FRAME_FALLBACK_BASE64_CHARS
    ) {
      return callRuntimeResult<string>(
        'clipboard.saveImageAsTempFile',
        { contentBase64, connectionId },
        CLIPBOARD_IMAGE_SAVE_TIMEOUT_MS
      )
    }
    throw new Error(startResponse.error.message)
  }

  const { uploadId } = startResponse.result
  try {
    for (
      let offset = 0;
      offset < contentBase64.length;
      offset += CLIPBOARD_IMAGE_UPLOAD_CHUNK_BASE64_CHARS
    ) {
      await callRuntimeResult(
        'clipboard.appendImageUploadChunk',
        {
          uploadId,
          offset,
          contentBase64: contentBase64.slice(
            offset,
            offset + CLIPBOARD_IMAGE_UPLOAD_CHUNK_BASE64_CHARS
          )
        },
        CLIPBOARD_IMAGE_SAVE_TIMEOUT_MS
      )
    }
    return await callRuntimeResult<string>(
      'clipboard.commitImageUpload',
      { uploadId },
      CLIPBOARD_IMAGE_SAVE_TIMEOUT_MS
    )
  } catch (error) {
    // Why: after chunked paste holds server-side state, release the bounded slot on failure rather than wait for TTL cleanup.
    await callRuntimeResult(
      'clipboard.abortImageUpload',
      { uploadId },
      CLIPBOARD_IMAGE_SAVE_TIMEOUT_MS
    ).catch(() => {})
    throw error
  }
}

export async function clipboardHasImage(): Promise<boolean | null> {
  if (!navigator.clipboard?.read) {
    return null
  }
  const items = await navigator.clipboard.read()
  return items.some((item) => clipboardFormatsIncludeImage(item.types))
}
