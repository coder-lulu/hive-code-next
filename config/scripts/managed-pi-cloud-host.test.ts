import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { produceManagedPiTextPack } from '../build-plugins/managed-pi-pack-producer'
import { loadManagedPiTextPack } from '../../src/main/runtime/managed-pi-pack-loader'
import { AgentSessionRecordStore } from '../../src/main/runtime/agent-session-record-store'
import { HiveAgentCloudHost } from '../../src/main/native-chat/hive-agent-cloud-host'
import { HIVE_AGENT_METHODS } from '../../src/shared/hive-agent-session-methods'
import { controlCommand, controlOwner } from '../../src/shared/hive-ai-text-control.test-fixture'
import { parseHiveAiTextGrantRequest } from '../../src/shared/hive-ai-text-grant-request'
import { canonicalHiveAiTextRequest } from '../../src/shared/hive-ai-text-request'
import { sha256 } from '../../src/main/hive-runtime-cloud/hive-runtime-cloud-proof-core'
import { JournalHostDatabase } from '../../src/main/native-chat/agent-session-journal/journal-host-database'

const transport = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('../../src/main/network/http-client', () => ({ getMainHttpClient: () => transport }))
let root: string
let pack: Awaited<ReturnType<typeof loadManagedPiTextPack>>
beforeAll(async () => {
  const base = resolve('logs/managed-pi-cloud-host-tests')
  await mkdir(base, { recursive: true })
  root = await mkdtemp(join(base, 'actual-pack-'))
  const built = await produceManagedPiTextPack(resolve('.'), join(root, 'pack'))
  pack = await loadManagedPiTextPack({ rootDirectory: built.root, indexSha256: built.indexSha256 })
}, 30000)
afterAll(async () => {
  pack?.dispose()
  if (root) {
    await rm(root, { recursive: true, force: true })
  }
})

it.each([
  ['CHAT_COMPLETIONS', true],
  ['RESPONSES', true],
  ['CHAT_COMPLETIONS', false]
] as const)(
  'assembles actual Pi, Cloud clients and journal: %s terminal=%s',
  async (protocol, terminal) => {
    const directory = await mkdtemp(join(root, 'session-'))
    const store = await AgentSessionRecordStore.open({ directory, hostId: 'local' })
    const journalDatabase = JournalHostDatabase.open(directory)
    const keys = generateKeyPairSync('ed25519')
    const runtime = controlCommand.runtime
    const identity = {
      schemaVersion: 1 as const,
      runtimeInstanceId: runtime.runtimeInstanceId,
      createdAt: 1,
      privateKeyPkcs8: keys.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
      publicKey: keys.publicKey
        .export({ type: 'spki', format: 'der' })
        .subarray(-32)
        .toString('base64url')
    }
    const scope = {
      ...controlOwner,
      projectScope: 'folder:project',
      workspaceKind: 'folder' as const
    }
    let authorized = true
    const assertCurrent = () => {
      if (!authorized) {
        throw new Error('hive_agent_forbidden')
      }
    }
    const principal = () =>
      authorized
        ? {
            ...scope,
            kind: 'local' as const,
            expiry: Date.now() + 60000,
            allowedMethods: Object.keys(HIVE_AGENT_METHODS),
            toolScopes: [],
            eligibilityRevision: 1
          }
        : null
    const authorization = {
      accountId: scope.accountId,
      authorityId: 'authority',
      accessToken: 'native-secret-canary',
      sessionGeneration: 1,
      sessionExpiresAt: Date.now() + 120000
    }
    const commands: ReturnType<typeof parseHiveAiTextGrantRequest>[] = []
    transport.fetch.mockReset()
    transport.fetch.mockImplementation(async (url: string, init: RequestInit) => {
      expect(init.method).toBe('POST')
      const headers = new Headers(init.headers)
      expect(headers.get('authorization')).toBe('Bearer native-secret-canary')
      expect(headers.get('x-hive-ai-proof')).toBeTruthy()
      if (url === 'https://cloud.test/hive/v1/ai/inferences/status') {
        const command = commands[0]
        return Response.json({
          contract: 'hive-ai-text-control-v1',
          requestId: command.request.requestId,
          generationId: command.request.generationId,
          modelId: command.request.modelId,
          protocol: command.request.protocol,
          state: 'COMPLETED',
          createdAt: new Date().toISOString(),
          execution: {
            gatewayRequestId: 'a'.repeat(24),
            status: 'COMPLETED',
            reason: 'TERMINAL',
            usage: null
          }
        })
      }
      const command = parseHiveAiTextGrantRequest(JSON.parse(String(init.body)))
      commands.push(command)
      const { messages: _, ...content } = command.request
      if (url === 'https://cloud.test/hive/v1/ai/grants') {
        return Response.json({
          requestId: content.requestId,
          grant: {
            claims: {
              domain: 'hive-ai-text-grant/v1',
              issuer: 'hive-ai-authority',
              audience: 'hive-ai-edge',
              authorityId: 'authority',
              algorithm: 'Ed25519',
              grant: {
                grantId: randomUUID(),
                owner: controlOwner,
                binding: {
                  ...content,
                  runtime,
                  projectScope: scope.projectScope,
                  ...command.pack,
                  requestHash: sha256(canonicalHiveAiTextRequest(command.request)),
                  credentialFence: 'c'.repeat(64),
                  gatewayRevision: 1
                },
                eligibilityRevision: 1,
                nonce: randomUUID(),
                issuedAt: new Date(Date.now() - 1000).toISOString(),
                expiresAt: new Date(Date.now() + 60000).toISOString()
              }
            },
            signature: 'A'.repeat(86)
          }
        })
      }
      expect(url).toBe('https://cloud.test/hive/v1/ai/inferences')
      expect(headers.get('x-hive-ai-grant')).toBeTruthy()
      const text = { type: 'text', requestId: content.requestId, sequence: 1, text: '组合验证 🐝' }
      const result = {
        type: 'result',
        requestId: content.requestId,
        sequence: 2,
        replay: false,
        state: 'COMPLETED',
        execution: {
          gatewayRequestId: 'a'.repeat(24),
          status: 'COMPLETED',
          reason: 'TERMINAL',
          usage: null
        }
      }
      return new Response(
        [text, ...(terminal ? [result] : [])]
          .map((event) => `data:${JSON.stringify(event)}\n\n`)
          .join(''),
        {
          headers: { 'Content-Type': 'text/event-stream' }
        }
      )
    })
    const owner = new HiveAgentCloudHost({
      resources: {
        store,
        journalDatabase,
        stateDirectory: directory,
        claimKeyId: 'cloud-host-test',
        assertCurrent
      },
      pack,
      origin: 'https://cloud.test',
      runtimeRecordId: runtime.runtimeRecordId,
      account: { getRuntimeCloudAuthorization: () => (authorized ? authorization : null) },
      presence: {
        getCurrentLeaseContext: () => ({ authorityId: 'authority', identity, tuple: runtime })
      },
      scopeFor: (entry) => ({ ...scope, sessionId: entry.aggregate.session.sessionId }),
      assertAuthorized: assertCurrent,
      principalForSession: principal,
      eligibilityRevision: () => 1,
      assertOrigin: assertCurrent,
      resolveModel: async (selection) => ({ selection, assertCurrent })
    })
    try {
      const host = await owner.open()
      const sessionId = `ha-session:${randomUUID()}`
      const operationId = () => `${Date.now()}-${randomUUID().replaceAll('-', '')}`
      expect(
        await host.call(
          'hiveAgent.create',
          { sessionId, profileId: 'personal', operationId: operationId() },
          principal
        )
      ).toMatchObject({ ok: true })
      const submit = {
        sessionId,
        operationId: operationId(),
        text: '仅本地组合验证',
        modelSelection: { modelId: 'model/text', protocol, snapshotRevision: 'a'.repeat(64) }
      }
      expect(await host.call('hiveAgent.submit', submit, principal)).toMatchObject({ ok: true })
      await host.drain()
      expect(store.hive.get(sessionId)?.aggregate.generation?.state).toBe(
        terminal ? 'COMPLETED' : 'UNKNOWN'
      )
      expect(transport.fetch).toHaveBeenCalledTimes(2)
      expect(commands[0]).toEqual(commands[1])
      expect(commands[0].request.protocol).toBe(protocol)
      expect(commands[0].request.requestId).toBe(
        store.hive.get(sessionId)?.aggregate.generation?.generationId.slice('ha-generation:'.length)
      )
      await host.call('hiveAgent.submit', submit, principal)
      expect(transport.fetch).toHaveBeenCalledTimes(2)
      expect(
        await host.call(
          'hiveAgent.execution',
          {
            sessionId,
            generationId: commands[0].request.generationId
          },
          principal
        )
      ).toMatchObject({ ok: true, value: { state: 'COMPLETED' } })
      expect(store.hive.get(sessionId)?.aggregate.generation?.state).toBe(
        terminal ? 'COMPLETED' : 'UNKNOWN'
      )
      expect(transport.fetch).toHaveBeenCalledTimes(3)
      const history = await host.call('hiveAgent.export', { sessionId }, principal)
      expect(history).toMatchObject({ ok: true })
      expect(JSON.stringify(history)).toContain('组合验证')
      expect(JSON.stringify(history)).not.toContain('native-secret-canary')
      authorized = false
      expect(await host.call('hiveAgent.history', { sessionId }, principal)).toMatchObject({
        ok: false
      })
    } finally {
      await owner.close()
      journalDatabase.close()
    }
  },
  30000
)
