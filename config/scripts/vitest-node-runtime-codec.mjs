import { parse, stringify } from 'devalue'

// RPC rejections contain real Errors, including non-enumerable diagnostic fields.
// Keep devalue's references/RegExp support rather than falling back to lossy JSON.
export function serializeNodeRuntimeMessage(message) {
  return stringify(message, {
    Error: (value) =>
      value instanceof Error && {
        ...Object.fromEntries(Object.getOwnPropertyNames(value).map((key) => [key, value[key]])),
        name: value.name,
        message: value.message,
        stack: value.stack
      }
  })
}

export function deserializeNodeRuntimeMessage(message) {
  if (typeof message !== 'string') {
    throw new Error('Invalid Node Vitest worker message')
  }
  return parse(message, {
    // Revive the existing payload in place: causes may point back to this Error.
    Error: (value) => Object.setPrototypeOf(value, Error.prototype)
  })
}
