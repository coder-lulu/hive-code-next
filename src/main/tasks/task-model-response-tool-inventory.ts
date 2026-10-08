import { array, deny, digest, id, object } from './task-model-policy-json'

function leaf(value: unknown) {
  const tool = object(
    value,
    'type name description parameters strict format output_schema defer_loading'
  )
  const allowed =
    tool.type === 'function'
      ? 'type name description parameters strict output_schema defer_loading'
      : tool.type === 'custom'
        ? 'type name description format defer_loading'
        : deny('RESPONSE_CONFIGURATION', 'tools')
  object(tool, allowed, 'type name')
  if (tool.defer_loading !== undefined && tool.defer_loading !== false) {
    deny('DEFERRED_TOOL_UNSUPPORTED')
  }
  if (Object.hasOwn(tool, 'output_schema') && tool.output_schema !== null) {
    deny('RESPONSE_CONFIGURATION', 'tools')
  }
  const { output_schema: _outputSchema, ...definition } = tool
  return { ...definition, name: id(tool.name) }
}

function sorted<T extends { name: string }>(tools: T[]): T[] {
  return tools.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/** Ordering and a null function output schema do not change the exact named inventory. */
export function taskModelResponseToolInventoryDigest(value: unknown): string {
  return digest(
    sorted(
      array(value).map((value) => {
        const tool = object(
          value,
          'type name description tools parameters strict format output_schema defer_loading'
        )
        if (tool.type !== 'namespace') {
          return leaf(tool)
        }
        object(tool, 'type name description tools', 'type name tools')
        return { ...tool, name: id(tool.name), tools: sorted(array(tool.tools).map(leaf)) }
      })
    )
  )
}
