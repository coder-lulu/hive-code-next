import { afterEach, describe, expect, it, vi } from 'vitest'
import { hiveRuntimeSessionCodec } from './paperclip-adapter-contract'
import { paperclipExecutionReferences } from './paperclip-adapter-result'
import { createServerAdapter } from './paperclip-runtime-adapter'
import { taskAdapterFixture } from './task-adapter.test-fixture'

let fixture: Awaited<ReturnType<typeof taskAdapterFixture>> | undefined
afterEach(async () => {
  await fixture?.close()
  fixture = undefined
})
const metadata = {
  paperclipAiCredentialIdentity: 'credential:paperclip',
  __paperclipConfiguredModel: 'model:paperclip',
  __paperclipConfigFingerprint: 'config:paperclip',
  __paperclipConfigFingerprintVersion: 1,
  __paperclipConfigCategories: ['adapter'],
  __paperclipConfigCategoryFingerprints: { adapter: 'config:adapter' }
}

describe('pinned Paperclip session metadata compatibility', () => {
  it('reads execution references decorated by Paperclip without retaining core metadata', async () => {
    fixture = await taskAdapterFixture()
    const refs = paperclipExecutionReferences(fixture.binding, 'session:test')
    const decorated = { ...refs, ...metadata }
    expect(hiveRuntimeSessionCodec.deserialize(decorated)).toEqual(refs)
    expect(hiveRuntimeSessionCodec.getDisplayId(decorated)).toBe('session:test')
    expect(hiveRuntimeSessionCodec.serialize(refs)).toEqual(refs)
    expect(hiveRuntimeSessionCodec.deserialize({ ...decorated, secret: 'unbound' })).toBeNull()
    expect(hiveRuntimeSessionCodec.serialize(decorated)).toBeNull()
  })
  it('resumes a decorated terminal execution without rejecting its binding or starting again', async () => {
    fixture = await taskAdapterFixture()
    const current = fixture
    current.deps.collect = vi.fn(async () => ({
      outcomeRef: 'outcome:test',
      artifactRefs: ['artifact:report']
    }))
    const adapter = createServerAdapter(async () => current.ports)
    const first = await adapter.execute(current.context)
    expect(first.exitCode).toBe(0)
    current.context.runtime.sessionParams = { ...first.sessionParams, ...metadata }
    const resumed = await adapter.execute(current.context)
    expect(resumed.exitCode).toBe(0)
    expect(resumed.resultJson?.resultRef).toBe(first.resultJson?.resultRef)
    expect(current.deps.launch).toHaveBeenCalledTimes(1)
  })
})
