import { beforeEach, expect, it, vi } from 'vitest'
import { createStructuredAgentSessionLogger } from './agent-session-wire/structured-agent-session-logger'
import { createManagedPiExecutionLeaseLogger } from './managed-pi-execution-lease-logger'

vi.mock('./agent-session-wire/structured-agent-session-logger', () => ({
  createStructuredAgentSessionLogger: vi.fn()
}))

const diagnostics = { warn: vi.fn(), error: vi.fn() }
const now = () => 123
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createStructuredAgentSessionLogger).mockReturnValue(diagnostics)
})

it('reports a failed renewal and immediately releases its owned driver', async () => {
  const dispose = vi.fn(async () => {})
  const logger = createManagedPiExecutionLeaseLogger({ now, recordId: 'pi-lease', dispose })
  const fields = { scope: 'lease-renewal', sessionId: 'pi-lease', error: new Error('revoked') }
  logger.warn('renewal refused', fields)
  expect(diagnostics.warn).toHaveBeenCalledWith('renewal refused', fields)
  expect(dispose).toHaveBeenCalledExactlyOnceWith()
  await dispose.mock.results[0]!.value
  expect(diagnostics.error).not.toHaveBeenCalled()
})

it('observes disposal rejection without masking the original renewal diagnostic', async () => {
  const failure = new Error('owner exit unproven')
  const dispose = vi.fn(async () => {
    throw failure
  })
  const logger = createManagedPiExecutionLeaseLogger({ now, recordId: 'pi-lease', dispose })
  logger.warn('renewal refused', { scope: 'lease-renewal' })
  await vi.waitFor(() =>
    expect(diagnostics.error).toHaveBeenCalledWith('disposing a failed managed Pi owner failed', {
      scope: 'managed-pi-dispose',
      sessionId: 'pi-lease',
      error: failure
    })
  )
  expect(diagnostics.warn).toHaveBeenCalledExactlyOnceWith('renewal refused', {
    scope: 'lease-renewal'
  })
})

it('retains ordinary error diagnostics without disposing a healthy owner', () => {
  const dispose = vi.fn(async () => {})
  const logger = createManagedPiExecutionLeaseLogger({ now, recordId: 'pi-lease', dispose })
  const fields = { scope: 'other-operation', error: new Error('read refused') }
  logger.error('read failed', fields)
  expect(diagnostics.error).toHaveBeenCalledExactlyOnceWith('read failed', fields)
  expect(dispose).not.toHaveBeenCalled()
  expect(createStructuredAgentSessionLogger).toHaveBeenCalledWith({ now })
})
