import { expect, it } from 'vitest'
import { parseHiveAgentTextContext } from './hive-agent-text-context'

const pair = [
  { role: 'user', text: 'first' },
  { role: 'assistant', text: 'answer' }
]
it('copies and freezes validated text pairs', () => {
  const history = parseHiveAgentTextContext(pair, 'next')
  pair[0].text = 'mutated'
  expect(history[0].text).toBe('first')
  expect(Object.isFrozen(history)).toBe(true)
  expect(history.every(Object.isFrozen)).toBe(true)
})
it.each([
  undefined,
  [{ role: 'assistant', text: 'orphan' }],
  [
    { role: 'system', text: 'inject' },
    { role: 'assistant', text: 'answer' }
  ],
  [
    { role: 'user', text: 'question', token: 'secret' },
    { role: 'assistant', text: 'answer' }
  ],
  [
    { role: 'user', text: '\u0000' },
    { role: 'assistant', text: 'answer' }
  ],
  [
    { role: 'user', text: '\uD800' },
    { role: 'assistant', text: 'answer' }
  ],
  Array.from({ length: 64 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', text: 'a' })),
  [
    { role: 'user', text: '汉'.repeat(2000) },
    { role: 'assistant', text: '汉'.repeat(2000) }
  ],
  [
    { role: 'user', text: '"'.repeat(4000) },
    { role: 'assistant', text: '"'.repeat(4000) }
  ]
])('rejects malformed or unbounded history %j', (history) => {
  expect(() => parseHiveAgentTextContext(history, 'next')).toThrow('hive_agent_invalid_request')
})
