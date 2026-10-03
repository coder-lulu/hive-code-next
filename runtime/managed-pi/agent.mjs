import { parseHiveAgentTextContext } from '../../src/shared/hive-agent-text-context.ts'
import { Agent } from '@earendil-works/pi-agent-core'
import corePackage from './node_modules/@earendil-works/pi-agent-core/package.json' with { type: 'json' }
import aiPackage from './node_modules/@earendil-works/pi-ai/package.json' with { type: 'json' }
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream'

export { createAssistantMessageEventStream }

export async function startManagedTextProcess() {
  const { startManagedPiTextProcess } = await import('./text-process.mjs')
  return startManagedPiTextProcess({
    getManagedPiRuntimeIdentity,
    runManagedTextGeneration,
    createAssistantMessageEventStream
  })
}

export function getManagedPiRuntimeIdentity() {
  return Object.freeze({
    schemaVersion: 1,
    nodeVersion: process.versions.node,
    piCoreVersion: corePackage.version,
    piAiVersion: aiPackage.version,
    platform: process.platform,
    architecture: process.arch,
    toolPolicy: 'empty',
    protocols: Object.freeze(['CHAT_COMPLETIONS', 'RESPONSES'])
  })
}

/** @param {{ model: import('@earendil-works/pi-ai').Model<any>, streamFn: import('@earendil-works/pi-agent-core').StreamFn }} options */
export function createManagedTextAgent({ model, streamFn, messages = [] }) {
  if (!model || typeof streamFn !== 'function') {
    throw new Error('Managed Pi requires an explicit model and inference stream')
  }
  return new Agent({
    initialState: { model, tools: [], messages, systemPrompt: '', thinkingLevel: 'off' },
    streamFn
  })
}

/** Owned single-turn kernel; the supervisor supplies the explicit Hive inference stream. */
export async function* runManagedTextGeneration({ input, streamFn }) {
  const { signal, text } = input
  const history = parseHiveAgentTextContext(input.history, text)
  const executionBinding = Object.freeze({ ...input.executionBinding })
  const modelSelection = Object.freeze({ ...input.modelSelection })
  const api = { CHAT_COMPLETIONS: 'openai-completions', RESPONSES: 'openai-responses' }[
    modelSelection.protocol
  ]
  if (
    !api ||
    executionBinding.protocol !== modelSelection.protocol ||
    executionBinding.toolPolicy !== 'empty' ||
    typeof streamFn !== 'function' ||
    typeof text !== 'string' ||
    !text.isWellFormed() ||
    Buffer.byteLength(text) > 12000 ||
    !text.trim() ||
    !signal ||
    typeof signal.addEventListener !== 'function' ||
    !Number.isSafeInteger(executionBinding.maxOutputTokens) ||
    executionBinding.maxOutputTokens < 1 ||
    executionBinding.maxOutputTokens > 2000 ||
    !Number.isSafeInteger(executionBinding.maxInputTokens) ||
    executionBinding.maxInputTokens < 1 ||
    executionBinding.maxInputTokens > 16000
  ) {
    throw new Error('hive_agent_invalid_request')
  }
  if (signal.aborted) {
    return
  }
  const model = Object.freeze({
    id: modelSelection.modelId,
    name: modelSelection.modelId,
    api,
    provider: 'hive',
    baseUrl: 'hive-managed://inference',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: executionBinding.maxInputTokens,
    maxTokens: executionBinding.maxOutputTokens
  })
  let calls = 0
  let rawTerminals = 0
  let failure
  let finalMessage
  let output = ''
  let outputBytes = 0
  let sequence = 0
  let pending
  let wake = () => {}
  let acknowledge = () => {}
  let closed = false
  let finished = false
  const publish = async (event) => {
    if (closed || signal.aborted) {
      return
    }
    const resumed = new Promise((resolve) => {
      acknowledge = resolve
    })
    pending = Object.freeze({ sequence: ++sequence, ...event })
    wake()
    await resumed
  }
  const agent = createManagedTextAgent({
    model,
    messages: history.map((message) => ({
      role: message.role,
      content: [{ type: 'text', text: message.text }],
      timestamp: 0,
      ...(message.role === 'assistant'
        ? {
            api,
            model: model.id,
            provider: model.provider,
            stopReason: 'stop',
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
            }
          }
        : {})
    })),
    streamFn: async (actual, context, options) => {
      if (
        signal.aborted ||
        ++calls !== 1 ||
        actual.id !== model.id ||
        actual.api !== api ||
        context.tools?.length !== 0 ||
        context.systemPrompt !== '' ||
        options?.apiKey
      ) {
        failure = new Error('hive_agent_outcome_unknown')
        throw failure
      }
      const response = await streamFn(actual, context, { ...options, maxTokens: model.maxTokens })
      return {
        result: () => response.result(),
        async *[Symbol.asyncIterator]() {
          for await (const event of response) {
            // Pi discards raw terminal reasons and updates before start.
            if (
              rawTerminals !== 0 ||
              !['start', 'text_start', 'text_delta', 'text_end', 'done'].includes(event.type) ||
              (event.type.startsWith('text_') && event.contentIndex !== 0) ||
              (event.type === 'text_delta' &&
                (typeof event.delta !== 'string' || !event.delta.isWellFormed()))
            ) {
              throw new Error('hive_agent_outcome_unknown')
            }
            if (event.type === 'done') {
              if (event.reason !== 'stop' || event.message.stopReason !== 'stop') {
                throw new Error('hive_agent_outcome_unknown')
              }
              rawTerminals++
            }
            yield event
          }
        }
      }
    }
  })
  agent.shouldStopAfterTurn = () => true
  const abort = () => {
    agent.abort()
    acknowledge()
    wake()
  }
  signal.addEventListener('abort', abort, { once: true })
  const unsubscribe = agent.subscribe(async (event) => {
    if (closed || signal.aborted || failure) {
      return
    }
    try {
      if (event.type.startsWith('tool_')) {
        throw new Error('unsupported tool event')
      }
      if (event.type === 'message_update') {
        const update = event.assistantMessageEvent
        if (!['start', 'text_start', 'text_delta', 'text_end', 'done'].includes(update.type)) {
          throw new Error('unsupported content')
        }
        if (update.type === 'text_delta' && update.delta !== '') {
          if (
            update.contentIndex !== 0 ||
            typeof update.delta !== 'string' ||
            !update.delta.isWellFormed() ||
            sequence >= 999 ||
            outputBytes + Buffer.byteLength(update.delta) > 1024 * 1024
          ) {
            throw new Error('invalid text output')
          }
          output += update.delta
          outputBytes += Buffer.byteLength(update.delta)
          await publish({ type: 'text', text: update.delta })
        }
      }
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        if (finalMessage) {
          throw new Error('multiple assistant messages')
        }
        finalMessage = structuredClone(event.message)
        if (finalMessage.content.some((block) => block.type !== 'text')) {
          throw new Error('unsupported final content')
        }
      }
    } catch {
      failure = new Error('hive_agent_outcome_unknown')
      agent.abort()
      throw failure
    }
  })
  const running = (async () => {
    try {
      await agent.prompt(text)
      if (closed || signal.aborted) {
        return
      }
      if (
        failure ||
        calls !== 1 ||
        rawTerminals !== 1 ||
        agent.state.isStreaming ||
        !finalMessage ||
        finalMessage.api !== api ||
        finalMessage.model !== model.id ||
        finalMessage.provider !== model.provider ||
        finalMessage.stopReason !== 'stop' ||
        finalMessage.content.length > 1 ||
        agent.state.tools.length !== 0
      ) {
        throw new Error('invalid final evidence')
      }
      const finalText = finalMessage.content.length === 0 ? '' : finalMessage.content[0].text
      if (
        typeof finalText !== 'string' ||
        !finalText.isWellFormed() ||
        Buffer.byteLength(finalText) > 1024 * 1024
      ) {
        throw new Error('invalid final text')
      }
      if (finalText !== output) {
        if (output !== '') {
          throw new Error('final text mismatch')
        }
        await publish({ type: 'text', text: finalText })
      }
      await publish({ type: 'completed' })
    } catch {
      failure = new Error('hive_agent_outcome_unknown')
    } finally {
      finished = true
      wake()
    }
  })()
  try {
    while (!finished || pending) {
      if (signal.aborted) {
        break
      }
      if (pending) {
        const event = pending
        pending = undefined
        yield event
        acknowledge()
      } else {
        await new Promise((resolve) => {
          wake = resolve
        })
      }
    }
    if (!signal.aborted && failure) {
      throw failure
    }
  } finally {
    closed = true
    abort()
    await running
    unsubscribe()
    signal.removeEventListener('abort', abort)
  }
}
