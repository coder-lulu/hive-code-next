import { hoistPreludeCheckpoints } from './prelude-checkpoints'
import { driveReplyMatrix } from './reply-matrix'
import { replyMatrixNormalResult } from './reply-matrix-normal-result'
import {
  bindCompletions,
  interruptionSchedules,
  lifecycleSchedules,
  siblingSchedules
} from './schedule-driver'
import type { RecordingScenario } from './recording-scenario'

/**
 * One golden and the scenarios it is recorded from. Derived here rather than inside the suites so
 * the census and `rpc:record --prune` read the same derivation that records the file: a restated
 * expansion could agree with itself while disagreeing with what was recorded.
 *
 * Every `title` starts with the golden id, so `rpc:record <id>` can select it by test name.
 */
export type DerivedGolden = {
  id: string
  title: string
  family: string
  /** The matrix site this golden drives; absent for a pilot or schedule golden. */
  site?: string
  /** Lazy, so a family with no replayable success fails its own test instead of collection. */
  scenarios: () => RecordingScenario[]
  timeoutMs?: number
}

import { recordingDomainPlan } from '../../../../config/scripts/upstream-recording-inputs.mjs'

function omitRetiredInventoryAdmission(scenario: RecordingScenario): RecordingScenario {
  if (scenario.id !== 'inventory-lifecycle.unmount-before-1') {
    return scenario
  }
  // A late search refusal cannot start an inventory after this owner's unmount.
  return {
    ...scenario,
    steps: scenario.steps.filter(
      (step) =>
        !(
          ('bind' in step &&
            (step.bind === 'old-inventory' || step.bind === 'lifecycle-old-inventory')) ||
          ('complete' in step && step.complete === 'lifecycle-old-inventory')
        )
    )
  }
}

/** The manifest scenario a pilot golden expands from, which its suite also mounts and mutates. */
export type PilotGolden = DerivedGolden & { scenario: RecordingScenario }

/** One golden per manifest scenario, recorded as written. */
export function pilotGoldens(manifest: readonly RecordingScenario[]): PilotGolden[] {
  return manifest.map((scenario) => ({
    id: scenario.id,
    title: `${scenario.id}: replays its recording deterministically`,
    family: scenario.family,
    scenario,
    scenarios: () => [scenario]
  }))
}

/** Every golden generated from a family's base scenario: reply matrices and owned schedules. */
export function familyGoldens(manifest: readonly RecordingScenario[]): DerivedGolden[] {
  return recordingDomainPlan(manifest).flatMap((plan): DerivedGolden[] => {
    const { id, family, base } = plan
    switch (plan.kind) {
      case 'pilot':
        return []
      case 'matrix':
        return [
          {
            id,
            family,
            title: id + ': ' + family + ' reply partitions at ' + plan.site,
            site: plan.site,
            timeoutMs: 30_000,
            scenarios: () =>
              driveReplyMatrix(
                base,
                plan.site,
                replyMatrixNormalResult(family, plan.scenarios, plan.site)
              )
          }
        ]
      case 'sibling':
        return [
          {
            id,
            family,
            title: id + ': completion orders and correlated faults',
            scenarios: () => siblingSchedules(base, plan.first, plan.second)
          }
        ]
      case 'interruption':
        return [
          {
            id,
            family,
            title: id + ': timeout, disconnect and stable-client cutover',
            scenarios: () => interruptionSchedules(base)
          }
        ]
      case 'lifecycle':
        return [
          {
            id,
            family,
            title: id + ': lifecycle boundaries',
            scenarios: () =>
              hoistPreludeCheckpoints(
                { ...base, steps: bindCompletions(base.steps) },
                plan.actions
                  .flatMap((action) => lifecycleSchedules(base, action))
                  .filter(
                    ({ scenario }) => !base.id.includes('hydration') || !scenario.id.endsWith('-1')
                  )
              ).map(omitRetiredInventoryAdmission)
          }
        ]
    }
  })
}

/** Every golden the oracle freezes, pilot and family alike. */
export function derivedGoldens(manifest: readonly RecordingScenario[]): DerivedGolden[] {
  return [...pilotGoldens(manifest), ...familyGoldens(manifest)]
}
