import { persistHiveModelSelection } from './model-preference.mjs'

export function readHiveProvider(environment = process.env) {
  const url = new URL(environment.HIVECODE_AI_BASE_URL ?? '')
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password) {
    throw new Error('HiveCode AI requires its authenticated local bridge')
  }
  if (!environment.HIVECODE_AI_LOCAL_TOKEN) {
    throw new Error('HiveCode AI login is required')
  }
  const models = JSON.parse(environment.HIVECODE_AI_MODELS ?? '[]')
  if (!Array.isArray(models) || models.length === 0) {
    throw new Error('HiveCode AI has no available models')
  }
  const ids = new Set()
  for (const model of models) {
    if (
      typeof model.id !== 'string' ||
      !model.id ||
      ids.has(model.id) ||
      !['openai-completions', 'openai-responses'].includes(model.api) ||
      !Number.isSafeInteger(model.contextWindow) ||
      model.contextWindow <= 0 ||
      !Number.isSafeInteger(model.maxTokens) ||
      model.maxTokens <= 0 ||
      model.maxTokens >= model.contextWindow
    ) {
      throw new Error('Invalid HiveCode AI model catalog')
    }
    ids.add(model.id)
  }
  return {
    name: 'HiveCode AI',
    baseUrl: url.href.replace(/\/$/, ''),
    apiKey: '$HIVECODE_AI_LOCAL_TOKEN',
    api: 'openai-completions',
    models: models.map((model) => ({
      id: model.id,
      name: model.name || model.id,
      api: model.api,
      reasoning: model.reasoning === true,
      input: model.input?.includes('image') ? ['text', 'image'] : ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens
    }))
  }
}

export default function hiveProvider(pi) {
  pi.registerProvider('hivecode', readHiveProvider())
  pi.on('model_select', (event, context) => persistHiveModelSelection(event, context.cwd))
  pi.on('session_start', (_event, context) => {
    if (context.hasUI) {
      context.ui.setHeader(
        () => new Text('HiveCode AI\nType a message to start, or / for commands.', 1, 0)
      )
    }
  })
}
import { Text } from '@earendil-works/pi-tui'
