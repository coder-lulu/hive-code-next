import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readPersistedTestAgentSessionStoreText } from '../runtime/agent-session-record-store-test-harness'
import {
  artifactReadFixture,
  artifactTextRef,
  artifactTextSha
} from './task-workflow-artifact-read.test-fixture'
import { TASK_TRANSPORT_MAX_BYTES } from './local-task-transport'

const fixtures: Awaited<ReturnType<typeof artifactReadFixture>>[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.close()))
})
async function fixture(content?: Buffer) {
  const f = await artifactReadFixture(content)
  fixtures.push(f)
  return f
}

describe('original filesystem artifact through native authorization and authenticated HTTP', () => {
  it('returns the original JSON text, name and actual blob SHA without assigning decision authority', async () => {
    const f = await fixture(),
      before = await readPersistedTestAgentSessionStoreText(join(f.root, 'records'))
    const artifact = await f.client.workflowArtifact(f.query)
    expect(artifact).toEqual({
      name: 'report.json',
      text: f.content.toString('utf8'),
      version: {
        artifactRef: f.query.artifactRef,
        artifactRevision: 1,
        digest: artifactTextSha(f.content)
      }
    })
    expect(Object.keys(artifact).sort()).toEqual(['name', 'text', 'version'])
    expect(JSON.parse(artifact.text)).toEqual({
      decision: 'approved',
      summary: 'Unit fixture only'
    })
    const { artifactRef: _ref, ...outcomeQuery } = f.query
    const sealed = await f.client.workflowOutcome({
      ...outcomeQuery,
      kind: 'workflow.outcome.read'
    })
    expect(sealed.outcome.artifacts[0]).toEqual({ name: artifact.name, version: artifact.version })
    expect(sealed.outcome.codeVersion?.kind).toBe('snapshot')
    await writeFile(join(f.record.workspace.executionPath, 'report.json'), 'late workspace edit')
    expect(await f.client.workflowArtifact(f.query)).toEqual(artifact)
    expect(await readFile(join(f.directory, f.query.artifactRef.slice(9)))).toEqual(f.content)
    expect(f.capture).toHaveBeenCalledTimes(1)
    expect(f.collectCommands).toHaveBeenCalledTimes(1)
    expect(f.unavailable).not.toHaveBeenCalled()
    expect(await readPersistedTestAgentSessionStoreText(join(f.root, 'records'))).toBe(before)
  })
  it('keeps start/final full record lookups fixed while guarding all artifact I/O', async () => {
    const f = await fixture(),
      get = vi.spyOn(f.store.tasks, 'get'),
      guard = vi.spyOn(f.caller, 'assertCurrent')
    await f.client.workflowArtifact(f.query)
    expect(get).toHaveBeenCalledTimes(2)
    expect(guard.mock.calls.length).toBeGreaterThan(10)
    expect(f.unavailable).not.toHaveBeenCalled()
  })
  it('preserves original UTF8 BOM bytes, version digest and command-bound artifact reference', async () => {
    const content = Buffer.from('\ufeff{"summary":"BOM unit report"}\n', 'utf8'),
      f = await fixture(content)
    const artifact = await f.client.workflowArtifact(f.query)
    expect(artifact.text).toBe(content.toString('utf8'))
    expect(artifact.text.charCodeAt(0)).toBe(0xfeff)
    expect(artifact.version.digest).toBe(artifactTextSha(content))
    expect(artifact.version.artifactRef).toBe(
      artifactTextRef(f.record.commandFingerprint, artifact.name, artifactTextSha(content))
    )
    expect(Buffer.from(artifact.text, 'utf8')).toEqual(content)
    expect(f.unavailable).not.toHaveBeenCalled()
  })
  it('refuses an artifact outside the original result even when its bytes exist locally', async () => {
    const f = await fixture()
    await writeFile(join(f.directory, 'f'.repeat(64)), 'Foreign result bytes')
    await expect(
      f.client.workflowArtifact({ ...f.query, artifactRef: `artifact:${'f'.repeat(64)}` })
    ).rejects.toThrow('FORBIDDEN')
    expect(f.unavailable).not.toHaveBeenCalled()
  })
  it('rejects inconsistent metadata returned by an artifact read port', async () => {
    const f = await fixture(),
      read = f.artifacts.read.bind(f.artifacts)
    vi.spyOn(f.artifacts, 'read').mockImplementationOnce(async (...args) => ({
      ...(await read(...args)),
      name: 'foreign.json'
    }))
    await expect(f.client.workflowArtifact(f.query)).rejects.toThrow('OUTCOME_UNKNOWN')
  })
  it.each(['revokeOwner', 'revokeCaller', 'revokeGrant', 'expire'] as const)(
    'refuses %s before artifact I/O',
    async (revoke) => {
      const f = await fixture(),
        read = vi.spyOn(f.outcomes, 'readArtifact')
      f[revoke]()
      await expect(f.client.workflowArtifact(f.query)).rejects.toThrow('FORBIDDEN')
      expect(read).not.toHaveBeenCalled()
      expect(f.unavailable).not.toHaveBeenCalled()
    }
  )
  it('refuses a foreign authenticated operation caller without opening artifact storage', async () => {
    const f = await fixture(),
      read = vi.spyOn(f.outcomes, 'readArtifact')
    await expect(
      f.host.workflowArtifact(f.query, { operationCallerKey: 'service:foreign' })
    ).rejects.toThrow('EXECUTION_NOT_FOUND')
    expect(read).not.toHaveBeenCalled()
  })
  it.each(['revokeOwner', 'revokeCaller', 'expire'] as const)(
    'refuses %s after the real artifact I/O finishes',
    async (revoke) => {
      const f = await fixture(),
        read = f.artifacts.read.bind(f.artifacts)
      vi.spyOn(f.artifacts, 'read').mockImplementationOnce(async (...args) => {
        const value = await read(...args)
        f[revoke]()
        return value
      })
      await expect(f.client.workflowArtifact(f.query)).rejects.toThrow('FORBIDDEN')
      expect(f.unavailable).not.toHaveBeenCalled()
    }
  )
  it('refuses tampered immutable blob bytes', async () => {
    const f = await fixture()
    await writeFile(join(f.directory, f.query.artifactRef.slice(9)), 'tampered artifact bytes')
    await expect(f.client.workflowArtifact(f.query)).rejects.toThrow('OUTCOME_UNKNOWN')
  })
  it('refuses an original file above the existing 1 MiB text limit', async () => {
    const f = await fixture(Buffer.alloc(1024 * 1024 + 1, 'x'))
    await expect(f.client.workflowArtifact(f.query)).rejects.toThrow('CAPABILITY_UNAVAILABLE')
    expect(f.unavailable).not.toHaveBeenCalled()
  })
  it('round-trips a 1 MiB escaped text file with a serialized response above 64 KiB', async () => {
    const f = await fixture(Buffer.alloc(1024 * 1024, 0))
    const artifact = await f.client.workflowArtifact(f.query)
    expect(Buffer.byteLength(artifact.text)).toBe(1024 * 1024)
    expect(Buffer.byteLength(JSON.stringify(artifact))).toBeGreaterThan(TASK_TRANSPORT_MAX_BYTES)
    expect(Buffer.byteLength(JSON.stringify(artifact))).toBeLessThan(8 * 1024 * 1024)
    expect(artifact.version.digest).toBe(artifactTextSha(f.content))
    expect(f.unavailable).not.toHaveBeenCalled()
  })
  it('retains strict source UTF8 decoding instead of replacing malformed bytes', async () => {
    const f = await fixture(Buffer.from([0xff]))
    await expect(f.client.workflowArtifact(f.query)).rejects.toThrow('SERVICE_UNAVAILABLE')
  })
})
