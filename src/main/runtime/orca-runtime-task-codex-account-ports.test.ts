import { describe, expect, it, vi } from 'vitest'
import type { TaskCodexAccountScope } from '../tasks/task-codex-account-scope'
import type { TaskCodexRuntimeAccountPorts } from '../tasks/task-codex-runtime-account-ports'
import { OrcaRuntimeService } from './orca-runtime'

class AccountPortsRuntime extends OrcaRuntimeService {
  readTaskCodexAccountPorts(): TaskCodexRuntimeAccountPorts | null {
    return this.taskCodexAccounts
  }
}

describe('original Runtime Task account dependency injection', () => {
  it('stores the exact injected ports without resolving accounts or subscribing during construction', () => {
    const scope: TaskCodexAccountScope = Object.freeze({
      accountId: 'synthetic-managed-row',
      codexHome: 'synthetic-unused-home',
      providerAccountId: 'synthetic_provider',
      assertCurrent: vi.fn(),
      assertMetadataCurrent: vi.fn()
    })
    const ports: TaskCodexRuntimeAccountPorts = Object.freeze({
      resolveSelected: vi.fn(() => scope),
      resolvePinned: vi.fn(() => scope),
      subscribe: vi.fn(() => vi.fn())
    })
    const runtime = new AccountPortsRuntime(null, undefined, { taskCodexAccounts: ports })
    expect(runtime.readTaskCodexAccountPorts()).toBe(ports)
    expect(ports.resolveSelected).not.toHaveBeenCalled()
    expect(ports.resolvePinned).not.toHaveBeenCalled()
    expect(ports.subscribe).not.toHaveBeenCalled()
  })
  it('keeps missing Task ports null while retaining the original personal constructor path', () => {
    const runtime = new AccountPortsRuntime()
    expect(runtime.readTaskCodexAccountPorts()).toBeNull()
  })
})
