import { useEffect, useState } from 'react'
import { AlertTriangle, ExternalLink, X } from 'lucide-react'
import type { Repo } from '../../../../shared/repo-types'
import type { PreflightIssue } from '../landing-preflight-issues'
import {
  dismissPreflightIssue,
  githubProjectKeys,
  isPreflightIssueDismissed
} from '../landing-preflight-dismissal'

export function LandingPreflightBanner({
  issues,
  repos
}: {
  issues: PreflightIssue[]
  repos: readonly Repo[]
}): React.JSX.Element | null {
  const githubKey = githubProjectKeys(repos).join('|')
  const [dismissed, setDismissed] = useState<Set<string>>(
    () =>
      new Set(
        issues
          .filter((issue) => issue.dismissible && isPreflightIssueDismissed(issue.id, repos))
          .map((issue) => issue.id)
      )
  )

  useEffect(() => {
    setDismissed(
      new Set(
        issues
          .filter((issue) => issue.dismissible && isPreflightIssueDismissed(issue.id, repos))
          .map((issue) => issue.id)
      )
    )
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [githubKey])

  const visibleIssues = issues.filter((issue) => !dismissed.has(issue.id))
  if (visibleIssues.length === 0) {
    return null
  }

  return (
    <div className="desktop-home-preflight" data-testid="landing-preflight">
      {visibleIssues.map((issue) => (
        <div key={issue.id} className="desktop-home-preflight-row">
          <AlertTriangle aria-hidden className="size-4 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-foreground">{issue.title}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {issue.description}
            </p>
            <button
              type="button"
              className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              onClick={() => window.api.shell.openUrl(issue.fixUrl)}
            >
              {issue.fixLabel}
              <ExternalLink className="size-3" />
            </button>
          </div>
          {issue.dismissible ? (
            <button
              type="button"
              className="desktop-home-icon-button"
              aria-label="关闭提示"
              onClick={() => {
                dismissPreflightIssue(issue.id, repos)
                setDismissed((current) => new Set(current).add(issue.id))
              }}
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  )
}
