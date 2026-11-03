import { describe, expect, it } from 'vitest'
import { normalizeCurrentTelemetry } from './current-telemetry-settings'

describe('current telemetry preferences', () => {
  it('uses the same current default regardless of retired profile cohort metadata', () => {
    const choices = [true, false].map(
      (existedBeforeTelemetryRelease) =>
        normalizeCurrentTelemetry({ existedBeforeTelemetryRelease }).optedIn
    )
    expect(choices).toEqual([true, true])
  })

  it.each([true, false, null])(
    'preserves the explicit preference %j and install identity',
    (optedIn) => {
      expect(
        normalizeCurrentTelemetry({
          optedIn,
          installId: 'current-install',
          existedBeforeTelemetryRelease: true
        })
      ).toEqual({ optedIn, installId: 'current-install' })
    }
  )

  it('creates an install identity when none was recorded', () => {
    expect(normalizeCurrentTelemetry(undefined)).toEqual({
      optedIn: true,
      installId: expect.stringMatching(/^[0-9a-f-]{36}$/)
    })
  })
})
