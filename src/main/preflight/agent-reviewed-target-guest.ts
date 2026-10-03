import type { AgentInstallRequest } from '../../shared/agent-install-types'
import { quoteStartupArg } from '../../shared/tui-agent-startup-shell'

export function reviewedGuestTargetGuard(request: AgentInstallRequest): string[] {
  return request.action === 'upgrade' && request.expectedRealPath
    ? [
        `_hive_reviewed_real="$(readlink -f -- "$_orca_active")" || exit 123`,
        `[ "$_hive_reviewed_real" = ${quoteStartupArg(request.expectedRealPath, 'posix')} ] || exit 123`
      ]
    : []
}
