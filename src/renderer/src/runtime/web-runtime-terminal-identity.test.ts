import { expect, it } from 'vitest'
import { readCreatedAgentTerminalIdentity } from './web-runtime-terminal-identity'

it('reads host coordinates while accepting additive and legacy fields', () => {
  expect(
    readCreatedAgentTerminalIdentity({
      terminal: { tabId: 'tab', paneKey: 'tab:leaf', handle: 'pty-1', future: true },
      disposition: 'created'
    })
  ).toEqual({ terminal: { tabId: 'tab', paneKey: 'tab:leaf', handle: 'pty-1' } })
  expect(readCreatedAgentTerminalIdentity({ terminal: { paneKey: null } })).toEqual({
    terminal: { tabId: undefined, paneKey: null }
  })
})

it.each([
  null,
  {},
  { terminal: null },
  { terminal: 'pty' },
  { terminal: { tabId: 12 } },
  { terminal: { paneKey: false } },
  { terminal: { handle: 12 } }
])('rejects malformed host coordinates: %j', (value) => {
  expect(() => readCreatedAgentTerminalIdentity(value)).toThrow('Host returned')
})
