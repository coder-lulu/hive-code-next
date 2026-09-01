import { describe, expect, it } from 'vitest'
import { resolveFolderSubmitLaunchText } from './folder-submit-orchestration'

describe('folder workspace launch text', () => {
  it('prefers the task prompt authored on the home composer', () => {
    expect(resolveFolderSubmitLaunchText('  implement permissions  ', 'workspace note')).toBe(
      'implement permissions'
    )
  })

  it('falls back to the workspace note when the task prompt is empty', () => {
    expect(resolveFolderSubmitLaunchText('   ', 'workspace note')).toBe('workspace note')
  })
})
