import { describe, expect, it } from 'vitest'
import { hasWorkflowNativeTestEvidence } from '../../integration/paperclip/service/workflow-native-test-evidence.mjs'

function facts(command = 'node --test', output = '# tests 1\n# pass 1\n# fail 0\n') {
  return {
    kind: 'available',
    turnOutcome: 'success',
    commands: [
      { command, cwd: '/workspace', state: 'completed', exitCode: 0, output: { head: output } }
    ]
  }
}

describe('concrete native test execution facts', () => {
  it.each(['node --test', 'npm test', 'pnpm test', 'pnpm exec vitest run', 'pytest', 'cargo test'])(
    'recognizes standalone %s with a positive native runner result',
    (command) => {
      expect(hasWorkflowNativeTestEvidence(facts(command))).toBe(true)
    }
  )
  it('recognizes the original captured shell wrapper without executing its text', () => {
    expect(hasWorkflowNativeTestEvidence(facts("/bin/bash -lc 'node --test'"))).toBe(true)
  })
  it.each([
    'echo "1 passed"',
    'printf "1 passed"',
    'exit 0',
    'ls',
    'node --test || true',
    'node --test; echo "1 passed"',
    'echo pytest'
  ])('does not approve %s', (command) => {
    expect(hasWorkflowNativeTestEvidence(facts(command))).toBe(false)
  })
  it.each(['', '0 passed', 'no tests found', 'no tests ran', '[no test files]', 'no tests to run'])(
    'does not approve an empty/no-tests result: %s',
    (output) => {
      expect(hasWorkflowNativeTestEvidence(facts('node --test', output))).toBe(false)
    }
  )
  it('keeps failed test commands from being hidden by a later successful command', () => {
    const value = facts()
    value.commands.unshift({ ...value.commands[0], state: 'failed', exitCode: 1 })
    expect(hasWorkflowNativeTestEvidence(value)).toBe(false)
  })
  it('does not use printed positive prose to override a zero-test runner result', () => {
    expect(
      hasWorkflowNativeTestEvidence(facts('node --test', '# tests 0\n# pass 0\n1 passed'))
    ).toBe(false)
  })
  it.each([
    '# tests 2\n# pass 1\n# fail 1',
    '1 passed, 1 failed',
    'Total tests: 2, Failed: 1, Passed: 1',
    'Tests run: 2, Failures: 1, Errors: 0'
  ])('refuses recorded failures when a test wrapper swallows its exit code: %s', (output) => {
    expect(hasWorkflowNativeTestEvidence(facts('npm test', output))).toBe(false)
  })
  it('does not hide a failed zero-exit test behind a later successful test', () => {
    const value = facts()
    value.commands.push(facts('npm test', '1 passed, 1 failed').commands[0])
    expect(hasWorkflowNativeTestEvidence(value)).toBe(false)
  })
  it('preserves failed non-test facts without interpreting them as a failed test', () => {
    const value = facts()
    value.commands.unshift({
      ...value.commands[0],
      command: 'rg nonexistent',
      state: 'failed',
      exitCode: 1
    })
    expect(hasWorkflowNativeTestEvidence(value)).toBe(true)
    expect(value.commands).toHaveLength(2)
  })
  it('requires the actual supplied workspace and successful original turn', () => {
    const value = facts()
    value.commands[0].cwd = '/tmp'
    expect(hasWorkflowNativeTestEvidence(value)).toBe(false)
    value.commands[0].cwd = '/workspace'
    value.turnOutcome = 'failure'
    expect(hasWorkflowNativeTestEvidence(value)).toBe(false)
    expect(hasWorkflowNativeTestEvidence({ kind: 'unavailable' })).toBe(false)
    expect(hasWorkflowNativeTestEvidence({ ...facts(), commands: [] })).toBe(false)
  })
})
