import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  AGENT_SESSION_RESTART_CONTINUATION_MESSAGE,
  AGENT_SESSION_RESTART_WORK_CONTINUATION_MESSAGE,
  restartContinuationMessage
} from './agent-session-restart-continuation'

describe('the restart continuation message', () => {
  it('preserves the bodies used by persisted offer fingerprints across product branding changes', () => {
    expect(
      createHash('sha256').update(AGENT_SESSION_RESTART_CONTINUATION_MESSAGE).digest('hex')
    ).toBe('cde8532346c35f9b47954e79e720550ed8b769fd4a4ee8419576616fc1014462')
    expect(
      createHash('sha256').update(AGENT_SESSION_RESTART_WORK_CONTINUATION_MESSAGE).digest('hex')
    ).toBe('bfc4e80404ff78ac15d1a579d7769e70a114fbb30663779dd6f3adbb61bee7a6')
  })
  it('keeps the original wording for a marker from a build that recorded only a working lead', () => {
    expect(restartContinuationMessage({})).toBe(AGENT_SESSION_RESTART_CONTINUATION_MESSAGE)
  })

  // The fingerprint covers the body, so it may depend on nothing the journal can restate.
  it('covers every kind of stopped work for a marker that carries a snapshot', () => {
    expect(
      restartContinuationMessage({ activity: { state: 'working', prompts: [], tasks: [] } })
    ).toBe(AGENT_SESSION_RESTART_WORK_CONTINUATION_MESSAGE)
  })
})
