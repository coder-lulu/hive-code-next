import { createServer } from 'node:http'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect } from 'vitest'
import { runProcess } from '../../../src/shared/child-process/run-process'

export async function createRelayNativePiTranscript(directory: string) {
  const hostDirectory = join(directory, 'native-host')
  mkdirSync(hostDirectory, { recursive: true })
  const sample = join(hostDirectory, 'sample.txt')
  const transcriptPath = join(hostDirectory, 'session.jsonl')
  const proof = 'p5-host-owned-native-read-proof-20260926'
  writeFileSync(sample, proof)
  const requests: { messages: { role: string; content: unknown }[] }[] = []
  const errors: string[] = []
  const server = createServer(async (request, response) => {
    try {
      if (request.headers.authorization !== 'Bearer p5-local-fixture') {
        throw new Error('Fixture authentication required')
      }
      let body = ''
      for await (const chunk of request) {
        body += chunk
      }
      requests.push(JSON.parse(body))
      const first = requests.length === 1
      const delta = first
        ? {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: 'p5_read',
                type: 'function',
                function: { name: 'read', arguments: JSON.stringify({ path: sample }) }
              }
            ]
          }
        : { role: 'assistant', content: 'P5 native tool completed' }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(
        `data: ${JSON.stringify({
          id: 'p5-fixture',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'fixture-model',
          choices: [{ index: 0, delta, finish_reason: first ? 'tool_calls' : 'stop' }]
        })}\n\ndata: [DONE]\n\n`
      )
    } catch {
      errors.push('Native model fixture failed')
      response.writeHead(500).end()
    }
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Missing fixture listener')
    }
    const result = await runProcess({
      program: process.execPath,
      args: [
        '--import',
        pathToFileURL(resolve('runtime/native-pi/launcher.mjs')).href,
        resolve('runtime/native-pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),
        '--offline',
        '--model',
        'fixture-model',
        '--print',
        '--mode',
        'json',
        '--session',
        transcriptPath,
        '--tools',
        'read',
        'Read sample.txt'
      ],
      cwd: hostDirectory,
      timeoutMs: 45_000,
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: join(hostDirectory, 'agent'),
        HIVECODE_AI_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
        HIVECODE_AI_LOCAL_TOKEN: 'p5-local-fixture',
        HIVECODE_AI_MODELS: JSON.stringify([
          {
            id: 'fixture-model',
            api: 'openai-completions',
            contextWindow: 32768,
            maxTokens: 4096
          }
        ])
      }
    })
    expect(errors).toEqual([])
    expect(result.code, result.stderr).toBe(0)
    expect(requests).toHaveLength(2)
    expect(
      requests[1]!.messages.some(
        (message) => message.role === 'tool' && JSON.stringify(message.content).includes(proof)
      )
    ).toBe(true)
    const header = JSON.parse(readFileSync(transcriptPath, 'utf8').split('\n')[0]!)
    expect(header.type).toBe('session')
    return { agent: 'hivecode' as const, sessionId: String(header.id), transcriptPath }
  } finally {
    server.closeAllConnections()
    await new Promise<void>((done) => server.close(() => done()))
  }
}
