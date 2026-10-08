import { describe, expect, it } from 'vitest'
import { workflowHandoffSummary } from '../../integration/paperclip/service/workflow-case-outcome-consumer.mjs'
import { TaskProgressSummary } from '../../src/shared/task-execution/task-execution-primitives.ts'

describe('native report handoff summary', () => {
  it.each(['a', '需', '😀'])('bounds long %s reports to the wire character limit', (character) => {
    const text = `  ${character.repeat(5412)}  `
    const summary = workflowHandoffSummary(text)
    expect(TaskProgressSummary.safeParse(summary).success).toBe(true)
    expect([...summary]).toHaveLength(2048)
    expect(summary).toBe(character.repeat(2048))
    expect(text.length).toBeGreaterThan(summary.length)
  })

  it('keeps a supplementary character whole at the truncation boundary', () => {
    const text = `${'a'.repeat(2047)}😀tail`
    expect(workflowHandoffSummary(text)).toBe(`${'a'.repeat(2047)}😀`)
  })

  it('preserves short report text after trimming', () => {
    expect(workflowHandoffSummary('  Original requirements 😀\n')).toBe('Original requirements 😀')
  })

  it('uses the existing fallback for an empty report', () => {
    expect(workflowHandoffSummary(' \n\t ')).toBe('Native role output')
  })
})
