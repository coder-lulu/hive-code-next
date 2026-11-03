import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  createRestTestRig,
  acceptedDispatch,
  restTestSend,
  REST_TEST_CALLER as CALLER,
  REST_TEST_SESSION as SESSION,
  type RestTestRig
} from '../native-chat/agent-session-wire/structured-agent-session-rest-test-rig'
import {
  hostTestAttachParams,
  HOST_TEST_NOW as NOW
} from '../native-chat/agent-session-wire/structured-agent-session-host-test-data'
import type { AgentSessionOptionsResult } from '../../shared/agent-session-wire'
import { openTestAgentSessionRecordStore } from './agent-session-record-store-test-harness'

let rig: RestTestRig
beforeEach(async () => {
  rig = await createRestTestRig()
})
afterEach(async () => {
  await rig.dispose()
})

async function attach(reportedOptions: AgentSessionOptionsResult['current'] = {}) {
  rig.adapter.open = async () => ({ reportedOptions })
  await rig.restart()
  const attached = await rig.host.attach(
    CALLER,
    hostTestAttachParams(rig.store.getRecord(SESSION)?.lease.runtimeFence ?? null)
  )
  if (!attached.ok) {
    throw new Error(JSON.stringify(attached.refusal))
  }
  expect(attached).toMatchObject({ ok: true })
  await vi.waitFor(() =>
    expect(rig.host.collaboratorsForTests().sessions.get(SESSION)?.child?.phase).toBe('ready')
  )
}
async function save(options: Record<string, string>) {
  const fence = rig.store.getRecord(SESSION)!.lease.runtimeFence
  await rig.store.replaceSessionOptions({ sessionId: SESSION, fence, options, now: NOW })
  await rig.store.replaceSessionOptions({
    sessionId: SESSION,
    fence,
    permissionMode: 'own',
    now: NOW
  })
}
async function report(
  reportedOptions: AgentSessionOptionsResult['current'],
  fence?: number,
  generation?: string
) {
  const child = rig.host.collaboratorsForTests().sessions.get(SESSION)?.child
  if (!child) {
    throw new Error('expected acquired child')
  }
  await rig.host.handleAdapterEvent({
    type: 'options-reported',
    sessionId: SESSION,
    fence: fence ?? child.fence,
    acquisitionGeneration: generation ?? child.generation!,
    reportedOptions
  })
}
async function persisted() {
  return (await openTestAgentSessionRecordStore(rig.root)).getRecord(SESSION)
}

it('refuses failed startup without dispatching or replacing saved intent with defaults', async () => {
  await attach()
  const picked = { model: 'gpt-picked', effort: 'high', fastMode: 'false' }
  await save(picked)
  await rig.host.close(SESSION, 'evict')
  rig.adapter.open = async () => {
    throw new Error('model list unavailable')
  }
  await rig.restart()
  const attached = await rig.host.attach(
    CALLER,
    hostTestAttachParams(rig.store.getRecord(SESSION)?.lease.runtimeFence ?? null)
  )
  if (!attached.ok) {
    throw new Error(JSON.stringify(attached.refusal))
  }
  expect(attached).toMatchObject({ ok: true })
  await vi.waitFor(() =>
    expect(rig.host.collaboratorsForTests().sessions.get(SESSION)?.child?.phase).not.toBe(
      'starting'
    )
  )
  expect(rig.adapter.dispatch).not.toHaveBeenCalled()
  expect(await persisted()).toMatchObject({ options: picked, permissionMode: 'own' })
})

it('keeps typed Own and explicit false while publishing the current runtime permission separately', async () => {
  await attach()
  const picked = { model: 'gpt-picked', effort: 'high', fastMode: 'false' }
  await save(picked)
  await report({ model: 'gpt-runtime', effort: 'low', reportedPermissionMode: 'full-access' })
  expect(rig.host.readStatusSummary(SESSION)?.runtimePermission).toMatchObject({
    mode: 'full-access'
  })
  expect(await persisted()).toMatchObject({ options: picked, permissionMode: 'own' })
})

it.each([
  { model: '' },
  { model: 'default' },
  { model: 'gpt-default', defaulted: ['model'] as const }
])('does not save startup/config defaults or clear a picked model: %j', async (current) => {
  await attach(current)
  expect(rig.store.getRecord(SESSION)?.options ?? {}).toEqual({})
  const picked = { model: 'gpt-picked', effort: 'high', fastMode: 'false' }
  await save(picked)
  await report(current)
  expect(await persisted()).toMatchObject({ options: picked, permissionMode: 'own' })
})

it('fills only missing execution options after actual handover and delayed current-generation evidence', async () => {
  await attach()
  await save({ fastMode: 'false' })
  await report({ model: 'gpt-config', effort: 'low' })
  expect(rig.store.getRecord(SESSION)?.options).toEqual({ fastMode: 'false' })
  const accepted = acceptedDispatch()
  if (accepted.state !== 'accepted') {
    throw new Error('expected accepted provider execution')
  }
  rig.adapter.dispatch.mockResolvedValueOnce({
    ...accepted,
    ranOptions: { effort: 'high' }
  })
  // Restart picks up this adapter callback through the existing host fixture wrapper.
  await rig.host.close(SESSION, 'evict')
  await attach()
  const fence = rig.store.getRecord(SESSION)!.lease.runtimeFence
  expect(
    await rig.host.send(CALLER, restTestSend('run with provider evidence', fence))
  ).toMatchObject({ ok: true })
  await vi.waitFor(() => expect(rig.adapter.dispatch).toHaveBeenCalledOnce())
  await rig.host.collaboratorsForTests().serialize(SESSION, async () => {})
  expect(rig.store.getRecord(SESSION)?.options).toEqual({ fastMode: 'false' })
  await report({ model: 'gpt-execution', effort: 'low' })
  await vi.waitFor(() =>
    expect(rig.store.getRecord(SESSION)?.options).toEqual({
      model: 'gpt-execution',
      effort: 'high',
      fastMode: 'false'
    })
  )
  expect(await persisted()).toMatchObject({ permissionMode: 'own' })
})

it('rejects replaced-child evidence and preserves a concurrent model pick across store reopen', async () => {
  await attach()
  await save({ effort: 'high', fastMode: 'false' })
  const previous = rig.host.collaboratorsForTests().sessions.get(SESSION)!.child!
  await rig.host.close(SESSION, 'evict')
  await attach()
  await save({ model: 'gpt-picked', effort: 'high', fastMode: 'false' })
  await report({ model: 'gpt-stale', effort: 'low' }, previous.fence, previous.generation!)
  const accepted = acceptedDispatch()
  if (accepted.state !== 'accepted') {
    throw new Error('expected accepted provider execution')
  }
  rig.adapter.dispatch.mockResolvedValueOnce({
    ...accepted,
    ranOptions: { model: 'gpt-old', effort: 'low' }
  })
  expect(
    await rig.host.send(
      CALLER,
      restTestSend('concurrent pick wins', rig.store.getRecord(SESSION)!.lease.runtimeFence)
    )
  ).toMatchObject({ ok: true })
  await vi.waitFor(() => expect(rig.adapter.dispatch).toHaveBeenCalledOnce())
  await rig.host.collaboratorsForTests().serialize(SESSION, async () => {})
  expect(await persisted()).toMatchObject({
    options: { model: 'gpt-picked', effort: 'high', fastMode: 'false' },
    permissionMode: 'own'
  })
})
