// Why: centralizing the launcher keeps window suppression consistent across installers (#14815).

// Why: an absolute forward-slash path avoids PATH hijacking and survives cmd.exe and Git Bash.
export function getWindowsSystem32Path(relativePath: string): string {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  return `${systemRoot.replaceAll('\\', '/')}/System32/${relativePath}`
}

export function getWindowsPowerShellExecutablePath(): string {
  return getWindowsSystem32Path('WindowsPowerShell/v1.0/powershell.exe')
}

/**
 * Switches for the PowerShell that relays hook output and exit status
 * (#14818 — conhost does neither).
 *
 * The command line spells no flag beyond `-NoProfile`, because AV denies the
 * combinations. #16003 measured, on the reporting Kaspersky host:
 *
 *   -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -EncodedCommand  126
 *   -NoProfile -WindowStyle Hidden -EncodedCommand                          126
 *   -WindowStyle Hidden -EncodedCommand                                     126
 *   -NoProfile -EncodedCommand                                              0 (5/5)
 *   -NoProfile -ExecutionPolicy Bypass -Command                             0 (5/5)
 *
 * The denial is at CreateProcess and is independent of the payload: `exit 0` is
 * denied too, and bash reports it as `Permission denied`. So `-WindowStyle
 * Hidden` + `-EncodedCommand` is the pair that has to stop being spelled.
 * #16576 removed `-ExecutionPolicy Bypass` (kept in-payload below), which was
 * the one flag of the three NOT in the signature — hooks kept failing.
 *
 * `-WindowStyle Hidden` was the shipped fix for #14815 (+#14828, #15117,
 * #15447, #15767). Removing it is a real tradeoff and is recorded as such: its
 * suppression was never measured — #14825 confirmed it *visually*, #16576's
 * author stated it "remains unverified on a real box", and #15506's author
 * argued it cannot help a `.cmd` child that has no console to inherit. The
 * console is allocated by the parent chain, not by this command line.
 *
 * Do not restore the flag to fix a console report. That trades every hook on an
 * AV host for a flicker. The answer is to shorten the interpreter chain — the
 * shipped doctrine of #15520 and #15595 — or a launcher that owns no console.
 */
export const WINDOWS_POWERSHELL_HOOK_SWITCHES = '-NoProfile'

// Why: redirected PowerShell progress becomes CLIXML that can corrupt merged JSON output.
const HOOK_PROGRESS_SILENCER = "$ProgressPreference='SilentlyContinue'; "

// Why: encoding shields paths and switches from cmd.exe and MSYS rewriting (#6078, #14815).
export function encodeWindowsPowerShellHookCommand(command: string): string {
  return Buffer.from(`${HOOK_PROGRESS_SILENCER}${command}`, 'utf16le').toString('base64')
}

export function wrapWindowsPowerShellEncodedCommand(command: string): string {
  return `${getWindowsPowerShellExecutablePath()} ${WINDOWS_POWERSHELL_HOOK_SWITCHES} -EncodedCommand ${encodeWindowsPowerShellHookCommand(command)}`
}
