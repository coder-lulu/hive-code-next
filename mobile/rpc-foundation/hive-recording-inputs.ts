import { join } from 'node:path'
import { readScenarios } from '../src/test-support/rpc-recording/scenario-input'
import { derivedGoldens } from '../src/test-support/rpc-recording/derived-goldens'
import { recorderSha256 } from '../src/test-support/rpc-recording/recorder-digest'
import { adapterSha256 } from '../src/test-support/rpc-recording/adapter-digest'
import { scenarioSha256 } from '../src/test-support/rpc-recording/scenario-digest'

/** Use the recorder's active derivation and adapter ownership, never a second domain table. */
export function hiveRecordingInputs(root: string) {
  const scenarios = readScenarios(
    join(root, 'mobile/rpc-foundation/pilot-scenarios.json')
  ).scenarios
  return {
    digests: {
      recorderSha256: recorderSha256(root),
      scenariosSha256: scenarioSha256(scenarios),
      adapterSha256ByOperation: Object.fromEntries(
        scenarios.map((scenario) => [scenario.operation, adapterSha256(root, [scenario])])
      )
    },
    supportedIds: derivedGoldens(scenarios)
      .map((golden) => golden.id)
      .sort()
  }
}
