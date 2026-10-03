import { expect, it } from 'vitest'
import { normalizeHookPayload } from './agent-hook-listener'
import { createHookListenerState } from './agent-hook-listener/listener-state'
import { PANE_KEY } from './agent-hook-listener-test-harness'
import { getAgentResumeArgv, isResumableTuiAgent } from './agent-session-resume'

it('retains Hive identity and transcript through native Pi hooks and model switches', () => {
  const state = createHookListenerState()
  const post = (event: string, extra = {}) =>
    normalizeHookPayload(
      state,
      'pi',
      {
        paneKey: PANE_KEY,
        tabId: 'tab-1',
        worktreeId: 'wt',
        env: 'production',
        version: '1',
        payload: {
          hook_event_name: event,
          hivecode_native: true,
          session_id: 'session-1',
          session_file: '/account/sessions/session-1.jsonl',
          ...extra
        }
      },
      'production'
    )
  const started = post('session_start')!
  expect(started.providerSessionOnly).toBe(true)
  expect(started.payload.agentType).toBe('hivecode')
  const completed = post('agent_end', { model: 'hivecode/model-a' })!
  expect(completed.payload.agentType).toBe('hivecode')
  if (!isResumableTuiAgent(completed.payload.agentType)) {
    throw new Error('Missing resume owner')
  }
  expect(getAgentResumeArgv(completed.payload.agentType!, completed.providerSession!)).toEqual([
    'hivecode',
    '--session',
    '/account/sessions/session-1.jsonl'
  ])
  state.lastStatusByPaneKey = new Map([[PANE_KEY, completed]])
  expect(post('model_select', { model: 'hivecode/model-b' })?.payload).toMatchObject({
    agentType: 'hivecode',
    state: 'done',
    model: 'hivecode/model-b'
  })
})
