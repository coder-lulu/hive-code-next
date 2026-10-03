import type { editor } from 'monaco-editor'

/**
 * Collapses runs of unchanged lines in a diff into expandable bands, leaving a few
 * lines of context around each change. The combined diff view enables this
 * unconditionally; single-file diffs default to the same behavior while keeping
 * an explicit setting for users who prefer the full file.
 */
export function buildDiffEditorHideUnchangedOptions(
  collapseUnchangedRegions: boolean | undefined
): Pick<editor.IStandaloneDiffEditorConstructionOptions, 'hideUnchangedRegions'> {
  return {
    hideUnchangedRegions: { enabled: collapseUnchangedRegions !== false }
  }
}
