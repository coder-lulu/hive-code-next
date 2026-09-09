import { Agent } from '@earendil-works/pi-agent-core'

/** @param {{ model: import('@earendil-works/pi-ai').Model<any>, streamFn: import('@earendil-works/pi-agent-core').StreamFn }} options */
export function createManagedTextAgent({ model, streamFn }) {
  if (!model || typeof streamFn !== 'function') {
    throw new Error('Managed Pi requires an explicit model and inference stream')
  }
  return new Agent({
    initialState: { model, tools: [], messages: [], systemPrompt: '', thinkingLevel: 'off' },
    streamFn
  })
}
