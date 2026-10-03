export type HiveAgentContextMessage = Readonly<{ role: 'user' | 'assistant'; text: string }>

const encoder = new TextEncoder()
export function parseHiveAgentTextContext(
  value: unknown,
  text: string
): readonly HiveAgentContextMessage[] {
  if (!Array.isArray(value) || value.length > 62 || value.length % 2 !== 0) {
    throw new Error('hive_agent_invalid_request')
  }
  const messages = [...value, { role: 'user', text }].map((message, index) => {
    if (
      !message ||
      typeof message !== 'object' ||
      Object.getPrototypeOf(message) !== Object.prototype ||
      Object.keys(message).length !== 2 ||
      !Object.hasOwn(message, 'role') ||
      !Object.hasOwn(message, 'text') ||
      message.role !== (index % 2 === 0 ? 'user' : 'assistant') ||
      typeof message.text !== 'string' ||
      message.text.length > 12000 ||
      !message.text.isWellFormed() ||
      !message.text.trim() ||
      Array.from(message.text as string).some((char) => {
        const point = char.codePointAt(0)!
        return point === 127 || (point < 32 && !['\n', '\r', '\t'].includes(char))
      })
    ) {
      throw new Error('hive_agent_invalid_request')
    }
    return Object.freeze({ role: message.role, text: message.text }) as HiveAgentContextMessage
  })
  if (
    messages.reduce((sum, message) => sum + encoder.encode(message.text).byteLength, 0) > 12000 ||
    // Reserve space for the Cloud request envelope under its 16 KiB wire limit.
    encoder.encode(JSON.stringify(messages)).byteLength > 14000
  ) {
    throw new Error('hive_agent_invalid_request')
  }
  return Object.freeze(messages.slice(0, -1))
}
