import { describe, expect, it, vi } from 'vitest'
import { LocalTaskClient } from './local-task-client'
import { taskCommand } from './task-execution.test-fixture'
import { taskExecutionIdentity } from './task-execution-record'
import { artifactTextRef, artifactTextSha } from './task-workflow-artifact-read.test-fixture'

const command = taskCommand(),
  fingerprint = 'a'.repeat(64),
  text = '{"summary":"Unit report"}\n',
  name = 'report.json'
const digest = artifactTextSha(text),
  artifactRef = artifactTextRef(fingerprint, name, digest)
const query = {
  ...taskExecutionIdentity(command),
  commandFingerprint: fingerprint,
  authorizationRef: command.authorizationRef,
  authorizationRevision: command.authorizationRevision,
  expiresAt: command.expiresAt,
  kind: 'workflow.artifact.read',
  artifactRef
}
const artifact = { name, text, version: { artifactRef, artifactRevision: 1, digest } }
function clientFor(value: unknown) {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify(value)))
  return {
    client: new LocalTaskClient({
      baseUrl: 'http://127.0.0.1:12345',
      secret: 'a'.repeat(43),
      fetch: fetchImpl
    }),
    fetchImpl
  }
}

describe('strict native artifact client request, metadata and content binding', () => {
  it('accepts reordered declared fields and original content bytes', async () => {
    const { client } = clientFor({
      text,
      version: { digest, artifactRevision: 1, artifactRef },
      name
    })
    expect(await client.workflowArtifact(query)).toEqual(artifact)
  })
  it.each(['path', 'filePath', 'writersFenced', 'ownerProof', 'decision'])(
    'refuses request %s metadata before HTTP',
    async (field) => {
      const { client, fetchImpl } = clientFor(artifact)
      await expect(client.workflowArtifact({ ...query, [field]: true })).rejects.toThrow(
        'INVALID_REQUEST'
      )
      expect(fetchImpl).not.toHaveBeenCalled()
    }
  )
  it.each(['artifact:short', '../private', `artifact:${'a'.repeat(64)}\n`])(
    'refuses malformed request ref %s',
    async (ref) => {
      const { client, fetchImpl } = clientFor(artifact)
      await expect(client.workflowArtifact({ ...query, artifactRef: ref })).rejects.toThrow(
        'INVALID_REQUEST'
      )
      expect(fetchImpl).not.toHaveBeenCalled()
    }
  )
  it.each(['name', 'text', 'digest', 'artifactRef', 'artifactRevision'] as const)(
    'refuses tampered response %s',
    async (field) => {
      const tampered = structuredClone(artifact)
      if (field === 'name' || field === 'text') {
        tampered[field] = 'tampered'
      } else {
        Object.assign(tampered.version, {
          [field]: field === 'artifactRevision' ? 2 : 'f'.repeat(64)
        })
      }
      await expect(clientFor(tampered).client.workflowArtifact(query)).rejects.toThrow(
        'OUTCOME_UNKNOWN'
      )
    }
  )
  it.each([
    null,
    {},
    { ...artifact, decision: 'approved' },
    { ...artifact, version: { ...artifact.version, path: '/private' } },
    {
      ...artifact,
      text: '\ud800',
      version: { ...artifact.version, digest: artifactTextSha('\ud800') }
    }
  ])('rejects malformed or extra response metadata', async (value) => {
    await expect(clientFor(value).client.workflowArtifact(query)).rejects.toThrow('OUTCOME_UNKNOWN')
  })
  it('refuses a well formed blob response above 1 MiB even below the HTTP response bound', async () => {
    const text = 'x'.repeat(1024 * 1024 + 1),
      digest = artifactTextSha(text),
      artifactRef = artifactTextRef(fingerprint, name, digest)
    await expect(
      clientFor({
        name,
        text,
        version: { artifactRef, digest, artifactRevision: 1 }
      }).client.workflowArtifact({ ...query, artifactRef })
    ).rejects.toThrow('OUTCOME_UNKNOWN')
  })
  it('retains the bounded 8 MiB serialized artifact response', async () => {
    await expect(
      clientFor({ padding: 'x'.repeat(8 * 1024 * 1024) }).client.workflowArtifact(query)
    ).rejects.toThrow('SERVICE_UNAVAILABLE')
  })
})
