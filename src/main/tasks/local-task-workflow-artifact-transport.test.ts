import { request as httpRequest } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { artifactReadFixture } from './task-workflow-artifact-read.test-fixture'
import { TASK_TRANSPORT_MAX_BYTES } from './local-task-transport'
import { WORKFLOW_NATIVE_EVIDENCE_MAX_BYTES } from '../../shared/task-workflow/workflow-native-outcome'

const fixtures: Awaited<ReturnType<typeof artifactReadFixture>>[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.close()))
})
async function fixture() {
  const f = await artifactReadFixture()
  fixtures.push(f)
  return {
    ...f,
    url: `${f.transport.baseUrl}/execution/workflow-artifact`,
    headers: { Authorization: `Bearer ${f.credential.secret}`, 'Content-Type': 'application/json' }
  }
}

describe('private artifact route authentication and request/response bounds', () => {
  it('authenticates before reading or parsing the body', async () => {
    const f = await fixture(),
      read = vi.spyOn(f.outcomes, 'readArtifact')
    const response = await fetch(f.url, { method: 'POST', body: 'invalid JSON' })
    expect(response.status).toBe(401)
    expect(read).not.toHaveBeenCalled()
    expect(f.authorize).not.toHaveBeenCalled()
  })
  it.each(['Origin', 'Sec-Fetch-Site'])(
    'rejects a browser or foreign %s header before native reads',
    async (header) => {
      const f = await fixture(),
        read = vi.spyOn(f.outcomes, 'readArtifact')
      const response = await fetch(f.url, {
        method: 'POST',
        headers: { ...f.headers, [header]: 'https://foreign.invalid' },
        body: JSON.stringify(f.query)
      })
      expect(response.status).toBe(403)
      expect(read).not.toHaveBeenCalled()
    }
  )
  it('rejects a foreign HTTP Host authority before native reads', async () => {
    const f = await fixture(),
      read = vi.spyOn(f.outcomes, 'readArtifact')
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        f.url,
        { method: 'POST', headers: { ...f.headers, Host: 'foreign.invalid:12345' } },
        (response) => {
          response.resume()
          response.on('end', () => resolve(response.statusCode!))
        }
      )
      request.on('error', reject)
      request.end(JSON.stringify(f.query))
    })
    expect(status).toBe(403)
    expect(read).not.toHaveBeenCalled()
  })
  it('retains the original 64 KiB declared request limit', async () => {
    const f = await fixture()
    const response = await fetch(f.url, {
      method: 'POST',
      headers: f.headers,
      body: ' '.repeat(TASK_TRANSPORT_MAX_BYTES + 1)
    })
    expect(response.status).toBe(413)
    expect(f.authorize).not.toHaveBeenCalled()
  })
  it('retains the original 64 KiB chunked request limit', async () => {
    const f = await fixture()
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(f.url, { method: 'POST', headers: f.headers }, (response) => {
        response.resume()
        response.on('end', () => resolve(response.statusCode!))
      })
      request.on('error', reject)
      request.write(' '.repeat(TASK_TRANSPORT_MAX_BYTES))
      request.end('x')
    })
    expect(status).toBe(413)
    expect(f.authorize).not.toHaveBeenCalled()
  })
  it.each(['path', 'stopped', 'ownerProof'])(
    'rejects request %s fields before authority or I/O',
    async (field) => {
      const f = await fixture()
      const response = await fetch(f.url, {
        method: 'POST',
        headers: f.headers,
        body: JSON.stringify({ ...f.query, [field]: true })
      })
      expect(response.status).toBe(400)
      expect(f.authorize).not.toHaveBeenCalled()
      expect(f.unavailable).not.toHaveBeenCalled()
    }
  )
  it('rejects malformed delivery headers before artifact dispatch', async () => {
    const f = await fixture()
    const response = await fetch(f.url, {
      method: 'POST',
      headers: { ...f.headers, 'x-hive-delivery-generation': '1' },
      body: JSON.stringify(f.query)
    })
    expect(response.status).toBe(403)
    expect(f.authorize).not.toHaveBeenCalled()
  })
  it('bounds artifact serialization at 8 MiB without widening the outcome route', async () => {
    const f = await fixture()
    vi.spyOn(f.host, 'workflowArtifact').mockResolvedValueOnce({
      name: 'report.json',
      text: 'x'.repeat(WORKFLOW_NATIVE_EVIDENCE_MAX_BYTES),
      version: { artifactRef: f.query.artifactRef, artifactRevision: 1, digest: 'a'.repeat(64) }
    })
    const artifact = await fetch(f.url, {
      method: 'POST',
      headers: f.headers,
      body: JSON.stringify(f.query)
    })
    expect(artifact.status).toBe(503)
    expect(await artifact.json()).toEqual({ error: { code: 'CAPACITY_EXCEEDED' } })
    const { artifactRef: _ref, ...query } = f.query
    const value = await f.client.workflowOutcome({ ...query, kind: 'workflow.outcome.read' })
    vi.spyOn(f.host, 'workflowOutcome').mockResolvedValueOnce({
      ...value,
      outcome: {
        ...value.outcome,
        artifacts: [
          {
            name: 'x'.repeat(TASK_TRANSPORT_MAX_BYTES),
            version: value.outcome.artifacts[0].version
          }
        ]
      }
    })
    const outcome = await fetch(`${f.transport.baseUrl}/execution/workflow-outcome`, {
      method: 'POST',
      headers: f.headers,
      body: JSON.stringify({ ...query, kind: 'workflow.outcome.read' })
    })
    expect(outcome.status).toBe(503)
    expect(await outcome.json()).toEqual({ error: { code: 'CAPACITY_EXCEEDED' } })
  })
})
