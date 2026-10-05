import { openRegularTranscriptFile } from '../shared/agent-hook-listener/safe-transcript-opener'
import { readNodeFileHandleWithinLimit } from '../shared/node-bounded-file-reader'
import { throwIfAiVaultScanCancelled } from '../main/ai-vault/ai-vault-scan-cancellation'
import { BinarySessionTranscriptError } from '../main/ai-vault/remote-session-content-lines'
import { BINARY_PROBE_BYTES, MAX_TEXT_FILE_SIZE, isBinaryBuffer } from './fs-handler-utils'

export async function readRelayTranscriptFile(path: string) {
  const handle = await openRegularTranscriptFile(path)
  try {
    const { buffer } = await readNodeFileHandleWithinLimit(handle, MAX_TEXT_FILE_SIZE)
    const isBinary = isBinaryBuffer(buffer)
    return { content: isBinary ? '' : buffer.toString('utf8'), isBinary }
  } finally {
    await handle.close()
  }
}

/** The same open handle supplies the probe and stream, including across renames. */
export async function* readRelayTranscriptBytes(
  path: string,
  signal?: AbortSignal,
  options?: { regularFileOnly: true; maxBytes: number }
): AsyncGenerator<Buffer> {
  throwIfAiVaultScanCancelled(signal)
  const handle = await openRegularTranscriptFile(path)
  if (options?.regularFileOnly) {
    try {
      const read = await readNodeFileHandleWithinLimit(handle, options.maxBytes)
      if (isBinaryBuffer(read.buffer.subarray(0, BINARY_PROBE_BYTES))) {
        throw new BinarySessionTranscriptError()
      }
      throwIfAiVaultScanCancelled(signal)
      yield read.buffer
      return
    } finally {
      await handle.close()
    }
  }
  try {
    const probe = Buffer.alloc(BINARY_PROBE_BYTES)
    const { bytesRead } = await handle.read(probe, 0, probe.length, 0)
    if (isBinaryBuffer(probe.subarray(0, bytesRead))) {
      throw new BinarySessionTranscriptError()
    }
    const input = handle.createReadStream({ start: 0, autoClose: false, signal })
    try {
      for await (const chunk of input) {
        throwIfAiVaultScanCancelled(signal)
        if (!Buffer.isBuffer(chunk)) {
          throw new TypeError('Expected transcript byte buffer')
        }
        yield chunk
      }
    } finally {
      input.destroy()
    }
  } finally {
    await handle.close()
  }
}
