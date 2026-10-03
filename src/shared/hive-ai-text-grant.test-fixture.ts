import { controlCommand } from './hive-ai-text-control.test-fixture'
export const grantCommand = {
  runtime: controlCommand.runtime,
  projectScope: 'folder:project',
  pack: {
    packRevision: 'b'.repeat(64),
    profileId: 'personal',
    toolPolicy: 'empty',
    inputLimit: 16000,
    outputLimit: 2000
  },
  request: {
    requestId: controlCommand.requestId,
    sessionId: 'ha-session:22222222-2222-4222-8222-222222222222',
    generationId: 'ha-generation:33333333-3333-4333-8333-333333333333',
    modelId: 'model/text',
    protocol: 'CHAT_COMPLETIONS',
    snapshotRevision: 'a'.repeat(64),
    messages: [{ role: 'user', text: '你好\n🐝' }]
  }
}
