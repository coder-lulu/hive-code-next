import { beforeEach, expect, it, vi } from 'vitest'
import { agentInstallationRealPath, assertReviewedAgentTarget } from './agent-installation-identity'

const mocks = vi.hoisted(() => ({ real: vi.fn(), shim: vi.fn() }))
vi.mock('node:fs', () => ({ realpathSync: mocks.real }))
vi.mock('../../shared/child-process/windows-cmd-shim-resolution', () => ({
  resolveWindowsCmdShim: mocks.shim
}))
beforeEach(() => {
  vi.resetAllMocks()
  mocks.real.mockImplementation((value) => value)
})

it('verifies a Windows shim target rather than treating cmd and exe aliases as distinct installs', () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  mocks.shim.mockReturnValue({ program: 'C:\\node.exe', prefixArgs: ['C:\\tools\\codex.js'] })
  expect(agentInstallationRealPath('C:\\tools\\codex.cmd', {})).toBe('C:\\tools\\codex.js')
  expect(() =>
    assertReviewedAgentTarget(
      { agent: 'codex', expectedRealPath: 'c:\\TOOLS\\codex.js' },
      'C:\\tools\\codex.cmd',
      {}
    )
  ).not.toThrow()
})

it('refuses symlinks retargeted since inspection', () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  mocks.real.mockReturnValue('/other/codex')
  expect(() =>
    assertReviewedAgentTarget(
      { agent: 'codex', expectedRealPath: '/reviewed/codex' },
      '/bin/codex',
      {}
    )
  ).toThrow('upgrade-target-changed')
})

it('refuses a removed reviewed executable', () => {
  mocks.real.mockImplementation(() => {
    throw new Error('ENOENT')
  })
  expect(() =>
    assertReviewedAgentTarget(
      { agent: 'codex', expectedRealPath: '/reviewed/codex' },
      '/bin/codex',
      {}
    )
  ).toThrow('upgrade-target-changed')
})
