import { join } from 'node:path'
import { expect, vi } from 'vitest'
import type { AgentSessionRecord } from '../../src/shared/agent-session-record'
import type { ManagedPiTextInference } from '../../src/main/native-chat/managed-pi-inference-pump'
import { reserveManagedPiExecutionLease } from '../../src/main/runtime/managed-pi-execution-lease'
import { openManagedPiProcessSupervisor } from '../../src/main/runtime/managed-pi-process-supervisor'
import type { VerifiedManagedPiPack } from '../../src/main/runtime/managed-pi-runtime-identity'
import * as processPorts from '../../src/shared/child-process/run-process'

export async function proveManagedPiLongHome(
  fixture: {
    directory: string
    create: () => Promise<string>
    leaseOptions: (sessionId: string) => Parameters<typeof reserveManagedPiExecutionLease>[0]
    record: (sessionId: string) => AgentSessionRecord
    run: ManagedPiTextInference['run']
  },
  pack: VerifiedManagedPiPack,
  track: (dispose: () => Promise<void>) => void
): Promise<void> {
  const id = await fixture.create()
  let homeRoot = join(fixture.directory, 'long managed home with spaces 中文')
  while (homeRoot.length < 280) {
    homeRoot = join(homeRoot, 'long managed home with spaces 中文')
  }
  const lease = await reserveManagedPiExecutionLease({ ...fixture.leaseOptions(id), homeRoot })
  expect(lease.home.length).toBeGreaterThan(300)
  const spawning = vi.spyOn(processPorts, 'spawnProcess')
  try {
    const supervisor = await openManagedPiProcessSupervisor({
      pack,
      home: lease.home,
      ownership: lease.ownership
    })
    track(supervisor.dispose)
    expect(supervisor.identity.pid).toBeGreaterThan(0)
    expect(await supervisor.verify()).toEqual(supervisor.identity)
    expect(fixture.record(id).lease.claimStatus).toBe('live')
    expect(fixture.record(id).lease.ownerProcess).toEqual(supervisor.identity)
    lease.assertLive()
    const launch = spawning.mock.calls.find(([spec]) =>
      spec.args?.some((argument) => argument.includes('startManagedTextProcess'))
    )?.[0]
    expect(launch).toBeDefined()
    expect(launch?.env?.HOME).toBe(lease.home)
    expect(launch?.env?.USERPROFILE).toBe(lease.home)
    expect(fixture.run).not.toHaveBeenCalled()
  } finally {
    spawning.mockRestore()
  }
}
