function standaloneCommand(value) {
  const wrapper = value.match(/^(?:\S*\/)?(?:bash|sh|zsh|dash)\s+-(?:lc|c)\s+(['"])([\s\S]*)\1$/)
  const command = (wrapper ? wrapper[2] : value).trim()
  if (/[;|&<>\r\n$`]/.test(command)) {
    return null
  }
  return command
}

function testCommand(value) {
  const command = standaloneCommand(value)
  return (
    command !== null &&
    /^(?:(?:\S*\/)?node\s+--test\b|(?:npm|pnpm|yarn)\s+(?:run\s+)?test\b|(?:pnpm\s+exec\s+|npx\s+)?(?:vitest|jest)\b|(?:python(?:3)?\s+-m\s+)?pytest\b|(?:go|cargo|dotnet|mvn|gradle|\.\/gradlew)\s+test\b)/.test(
      command
    )
  )
}

function positiveTestResult(text) {
  if (
    /\b(?:no tests? (?:found|ran|to run|files)|0 tests? (?:passed|collected))\b/i.test(text) ||
    /^\s*#?\s*(?:tests|pass|Tests run|Total tests):?\s+0\b/im.test(text)
  ) {
    return false
  }
  return /\b[1-9]\d*\s+(?:passed|passing)\b|\b(?:tests|pass|Tests run|Total tests):?\s+[1-9]\d*\b|^ok\s+\S+\s+\d/m.test(
    text
  )
}

function failedTestResult(text) {
  return /\b[1-9]\d*\s+(?:failed|failing|errors?)\b|\b(?:fail|failed|failures|errors):?\s+[1-9]\d*\b/i.test(
    text
  )
}

/** Native commands are evidence for the authenticated Tester's proposal, never an authority grant. */
export function hasWorkflowNativeTestEvidence(facts) {
  if (facts?.kind !== 'available' || facts.turnOutcome !== 'success') {
    return false
  }
  const tests = facts.commands.filter((fact) => testCommand(fact.command))
  return (
    tests.length > 0 &&
    tests.every(
      (fact) =>
        fact.cwd === '/workspace' &&
        fact.state === 'completed' &&
        fact.exitCode === 0 &&
        (!fact.output || !failedTestResult(fact.output.head))
    ) &&
    tests.some((fact) => fact.output && positiveTestResult(fact.output.head))
  )
}
