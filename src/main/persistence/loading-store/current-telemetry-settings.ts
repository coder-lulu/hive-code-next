import { randomUUID } from 'node:crypto'
import type { GlobalSettings } from '../../../shared/global-settings-types'

export function mergeAgentDashboardActiveDays(current: unknown, requested: unknown) {
  const activeDays: Partial<Record<'in_window' | 'popout', number>> = {}
  for (const value of [current, requested]) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
    for (const surface of ['in_window', 'popout'] as const) {
      const day: unknown = Reflect.get(value, surface)
      if (typeof day === 'number' && Number.isSafeInteger(day) && day >= 0) {
        activeDays[surface] = Math.max(activeDays[surface] ?? 0, day)
      }
    }
  }
  return Object.keys(activeDays).length > 0 ? activeDays : undefined
}

export function normalizeCurrentTelemetry(
  value: unknown
): NonNullable<GlobalSettings['telemetry']> {
  const record = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const choice: unknown = Reflect.get(record, 'optedIn')
  const installId: unknown = Reflect.get(record, 'installId')
  const activeDays = mergeAgentDashboardActiveDays(
    undefined,
    Reflect.get(record, 'agentDashboardActiveDays')
  )
  return {
    optedIn: choice === true || choice === false || choice === null ? choice : true,
    installId: typeof installId === 'string' && installId.length > 0 ? installId : randomUUID(),
    ...(activeDays ? { agentDashboardActiveDays: activeDays } : {})
  }
}
