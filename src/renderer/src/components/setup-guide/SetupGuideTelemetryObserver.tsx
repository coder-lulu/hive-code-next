import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { useSetupGuideProgress } from './use-setup-guide-progress'
import { useSetupGuideStepCompletionTelemetry } from './use-setup-guide-telemetry'
import { publishSetupGuideProgressSnapshot } from './setup-guide-progress-snapshot'

export function SetupGuideTelemetryObserver(): null {
  const setupGuideVisible = useAppStore((s) => s.activeModal === 'setup-guide')
  const progress = useSetupGuideProgress(true, false, false)

  useEffect(() => {
    // Why: passive UI consumers can reuse the root observer's authoritative result instead of
    // launching their own runtime, skill, integration, and repository probes.
    publishSetupGuideProgressSnapshot(progress)
  }, [progress])

  useSetupGuideStepCompletionTelemetry({
    progress,
    setupGuideVisible
  })

  return null
}
