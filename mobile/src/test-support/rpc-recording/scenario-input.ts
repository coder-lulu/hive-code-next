import { readFileSync } from 'node:fs'
import { decodeScenarioInput } from '../../../../config/scripts/upstream-recording-inputs.mjs'
export function readScenarios(path: string) {
  return decodeScenarioInput(JSON.parse(readFileSync(path, 'utf8')))
}
