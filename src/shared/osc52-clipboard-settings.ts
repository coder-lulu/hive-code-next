import type { GlobalSettings } from './global-settings-types'

type Osc52ClipboardSettings = Pick<GlobalSettings, 'terminalAllowOsc52Clipboard'>

export function normalizeOsc52ClipboardDefaultOn(
  settings: Partial<Osc52ClipboardSettings> | undefined
): Osc52ClipboardSettings {
  return { terminalAllowOsc52Clipboard: settings?.terminalAllowOsc52Clipboard ?? true }
}
