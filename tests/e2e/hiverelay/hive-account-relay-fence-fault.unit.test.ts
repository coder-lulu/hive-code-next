import { expect, it } from 'vitest'
import { FenceFaultInjector } from './hive-account-relay-fence-fault'

it('keeps the target connected after Cloud rejects its fenced assignment refresh', async () => {
  const runtimeId = '11111111-1111-4111-8111-111111111111'
  const assignmentId = '22222222-2222-4222-8222-222222222222'
  const fault = new FenceFaultInjector(runtimeId)
  await fault.captureAssignment(
    runtimeId,
    '/hive/v1/runtimes/33333333-3333-4333-8333-333333333333/relay/control-leases/refresh',
    new Response(
      JSON.stringify({
        assignmentId,
        cellUrl: 'wss://cell.example/hive-relay',
        controlLease: 'fixture-control-lease',
        controlLeaseExpiresAt: 1893456000000
      }),
      { status: 200 }
    )
  )
  fault.start(assignmentId)

  const hidden = await fault.hideStaleRefresh(
    runtimeId,
    '/hive/v1/runtimes/33333333-3333-4333-8333-333333333333/relay/control-leases/refresh',
    new Response(JSON.stringify({ code: 'ASSIGNMENT_AUTHORITY_STALE' }), { status: 409 })
  )

  expect(hidden?.status).toBe(200)
  expect(await hidden?.json()).toMatchObject({
    assignmentId,
    controlLease: 'fixture-control-lease'
  })
  expect(fault.suppressedStaleRefreshes).toEqual([
    expect.objectContaining({ assignmentId, status: 409, code: 'ASSIGNMENT_AUTHORITY_STALE' })
  ])
})
