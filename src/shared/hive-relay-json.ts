import { parseTree, type Node } from 'jsonc-parser'
import { assertJsonTextStructureWithinLimits } from './json-text-structure-limit'

/** Authority messages reject ambiguous duplicate fields before schema validation. */
export function parseHiveRelayJson(text: string, maximumCharacters = 32 * 1024): unknown {
  if (text.length > maximumCharacters) {
    throw new Error('Relay JSON exceeds its limit')
  }
  assertJsonTextStructureWithinLimits(text, { structuralTokens: 256 * 1024, nestingDepth: 64 })
  const errors: { error: number; offset: number; length: number }[] = []
  const tree = parseTree(text, errors, { allowTrailingComma: false, disallowComments: true })
  if (!tree || errors.length) {
    throw new Error('Invalid Relay JSON')
  }
  const visit = (node: Node): void => {
    if (node.type === 'object') {
      const names = new Set<string>()
      for (const property of node.children ?? []) {
        const [key, value] = property.children ?? []
        if (!key || !value || names.has(key.value)) {
          throw new Error('Ambiguous Relay JSON')
        }
        names.add(key.value)
        visit(value)
      }
    } else if (node.type === 'array') {
      for (const child of node.children ?? []) {
        visit(child)
      }
    }
  }
  visit(tree)
  return JSON.parse(text) as unknown
}
