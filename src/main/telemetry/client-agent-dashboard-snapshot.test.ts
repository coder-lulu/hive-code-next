import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { persistBannerAcknowledgeWithoutEmitting, track, trackAppOpenedOnce } from './client'
import {
  cleanupTelemetryClientTest,
  setupTelemetryClientTest,
  type TelemetryClientTestState
} from './client-test-harness'

describe('Agent Dashboard app-open snapshot', () => {
  let state: TelemetryClientTestState

  beforeEach(() => {
    state = setupTelemetryClientTest()
  })

  afterEach(() => {
    cleanupTelemetryClientTest(state.envStash)
  })

  it('records the enabled Dashboard once per app session', () => {
    trackAppOpenedOnce()
    trackAppOpenedOnce()

    expect(state.mock.capture).toHaveBeenCalledTimes(1)
    expect(state.mock.capture.mock.calls[0]?.[0]).toMatchObject({
      event: 'app_opened',
      properties: {
        agent_dashboard_enabled: true,
        $process_person_profile: false
      }
    })
  })

  it('overrides a caller-provided snapshot with main-owned settings', () => {
    track('app_opened', { agent_dashboard_enabled: false })

    expect(state.mock.capture.mock.calls[0]?.[0].properties.agent_dashboard_enabled).toBe(true)
  })

  it('waits for pending consent without consuming the first app-open event', async () => {
    state.settings.telemetry!.optedIn = null
    trackAppOpenedOnce()
    expect(state.mock.capture).not.toHaveBeenCalled()

    await persistBannerAcknowledgeWithoutEmitting()
    trackAppOpenedOnce()

    expect(state.mock.capture).toHaveBeenCalledTimes(1)
    expect(state.mock.capture.mock.calls[0]?.[0]).toMatchObject({
      event: 'app_opened',
      properties: { agent_dashboard_enabled: true }
    })
  })
})
