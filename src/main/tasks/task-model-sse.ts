import {
  TASK_MODEL_EVENT_BYTES,
  TASK_MODEL_EVENT_LIMIT,
  TASK_MODEL_RESPONSE_BYTES
} from './task-model-channel-protocol'

function refused(): never {
  throw new Error('TASK_MODEL_STREAM_REFUSED')
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Validate a whole SSE event before making any of its bytes available to the guest. */
export function createTaskModelSseReader(validate: (data: string) => void) {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const partialLine: string[] = []
  let partialBytes = 0
  let eventName: string | undefined
  let dataLines: string[] = []
  let eventBytes = 0
  let eventLines = 0
  let responseId: string | undefined
  let completed = false
  let eventCount = 0
  let queuedBytes = 0
  const queue: (Buffer | undefined)[] = []
  let queueHead = 0
  let queueOffset = 0
  const appendLine = (fragment: string) => {
    if (fragment.length === 0) {
      return
    }
    const last = partialLine.length - 1
    if (last >= 0 && partialLine[last].length + fragment.length <= 4096) {
      partialLine[last] += fragment
    } else {
      partialLine.push(fragment)
    }
  }

  const terminalTail = () => {
    if (eventName !== undefined || (dataLines.length > 0 && dataLines.join('\n') !== '[DONE]')) {
      return false
    }
    if (partialLine.length === 0 || partialLine[0].startsWith(':')) {
      return true
    }
    if (partialBytes > 14) {
      return false
    }
    const partial = partialLine.join('')
    return ['data: [DONE]\r', 'data:[DONE]\r', '\r'].some((value) => value.startsWith(partial))
  }

  const finishEvent = () => {
    if (dataLines.length === 0) {
      eventName = undefined
      eventBytes = 0
      eventLines = 0
      return
    }
    const data = dataLines.join('\n')
    if (data === '[DONE]') {
      if (!completed) {
        refused()
      }
    } else {
      if (completed || ++eventCount > TASK_MODEL_EVENT_LIMIT) {
        refused()
      }
      const value: unknown = JSON.parse(data)
      if (
        !object(value) ||
        typeof value.type !== 'string' ||
        !/^[a-z._]{1,128}$/.test(value.type)
      ) {
        refused()
      }
      if (eventName !== undefined && eventName !== value.type) {
        refused()
      }
      validate(data)
      if (value.type === 'response.created' || value.type === 'response.completed') {
        if (
          !object(value.response) ||
          typeof value.response.id !== 'string' ||
          value.response.id.length === 0 ||
          value.response.id.length > 256
        ) {
          refused()
        }
        if (value.type === 'response.created') {
          if (responseId !== undefined) {
            refused()
          }
          responseId = value.response.id
        } else {
          if (responseId === undefined || value.response.id !== responseId) {
            refused()
          }
          completed = true
        }
      } else if (responseId === undefined) {
        refused()
      }
      const encoded = Buffer.from(`event: ${value.type}\ndata: ${data}\n\n`)
      if (queuedBytes + encoded.length > TASK_MODEL_RESPONSE_BYTES) {
        refused()
      }
      queue.push(encoded)
      queuedBytes += encoded.length
    }
    eventName = undefined
    dataLines = []
    eventBytes = 0
    eventLines = 0
  }

  const line = (value: string) => {
    eventBytes += Buffer.byteLength(value) + 1
    if (eventBytes > TASK_MODEL_EVENT_BYTES || ++eventLines > 128) {
      refused()
    }
    if (value.endsWith('\r')) {
      value = value.slice(0, -1)
    }
    if (value.length === 0) {
      finishEvent()
    } else if (!value.startsWith(':')) {
      const separator = value.indexOf(':')
      const field = separator === -1 ? value : value.slice(0, separator)
      const content = separator === -1 ? '' : value.slice(separator + 1).replace(/^ /, '')
      if (field === 'data') {
        dataLines.push(content)
      } else if (field === 'event' && eventName === undefined) {
        eventName = content
      } else {
        refused()
      }
    }
  }

  return {
    get completed() {
      return completed
    },
    get pendingBytes() {
      return queuedBytes
    },
    feed(bytes: Uint8Array): void {
      const text = decoder.decode(bytes, { stream: true })
      let cursor = 0
      for (;;) {
        const newline = text.indexOf('\n', cursor)
        if (newline === -1) {
          const fragment = text.slice(cursor)
          if (fragment.length > 0) {
            appendLine(fragment)
            partialBytes += Buffer.byteLength(fragment)
          }
          if (
            eventBytes + partialBytes > TASK_MODEL_EVENT_BYTES ||
            (completed && !terminalTail())
          ) {
            refused()
          }
          return
        }
        appendLine(text.slice(cursor, newline))
        line(partialLine.join(''))
        partialLine.length = 0
        partialBytes = 0
        cursor = newline + 1
      }
    },
    take(maxBytes: number): Buffer {
      const chunks: Buffer[] = []
      let remaining = maxBytes
      while (remaining > 0 && queueHead < queue.length) {
        const first = queue[queueHead]
        if (!first) {
          refused()
        }
        const length = Math.min(remaining, first.length - queueOffset)
        chunks.push(first.subarray(queueOffset, queueOffset + length))
        queuedBytes -= length
        remaining -= length
        queueOffset += length
        if (queueOffset === first.length) {
          queue[queueHead++] = undefined
          queueOffset = 0
          if (queueHead === queue.length) {
            queue.length = 0
            queueHead = 0
          }
        }
      }
      return Buffer.concat(chunks)
    },
    finish(): void {
      const tail = decoder.decode()
      if (tail.length !== 0 || !terminalTail() || !completed) {
        refused()
      }
    },
    reset(): void {
      partialLine.length = 0
      partialBytes = 0
      dataLines = []
      queue.length = 0
      queueHead = 0
      queuedBytes = 0
      queueOffset = 0
    }
  }
}
