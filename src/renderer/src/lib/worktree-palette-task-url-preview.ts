import { translate } from '@/i18n/i18n'
import type { CmdJTaskSourceUrl, CmdJTaskUrlCreatePreview } from './worktree-palette-task-url-match'

export function getCmdJTaskUrlCreatePreview(
  intent: CmdJTaskSourceUrl
): CmdJTaskUrlCreatePreview | null {
  if (intent.provider === 'linear') {
    return null
  }
  if (intent.provider === 'github') {
    const { slug, number, type } = intent.link
    const repo = `${slug.owner}/${slug.repo}`
    const kindLabel =
      type === 'pr'
        ? translate('components.taskUrlPreview.githubPullRequest', 'GitHub pull request')
        : translate('components.taskUrlPreview.githubIssue', 'GitHub issue')
    return {
      provider: 'github',
      identifier: `#${number}`,
      subtitle: repo,
      kindLabel,
      createLabel:
        type === 'pr'
          ? translate(
              'components.taskUrlPreview.githubPullRequestCreateLabel',
              'Create worktree from GitHub pull request {{identifier}}',
              { identifier: `${repo}#${number}` }
            )
          : translate(
              'components.taskUrlPreview.githubIssueCreateLabel',
              'Create worktree from GitHub issue {{identifier}}',
              { identifier: `${repo}#${number}` }
            )
    }
  }
  if (intent.provider === 'gitlab') {
    const { slug, number, type } = intent.link
    const project = `${slug.host}/${slug.path}`
    const kindLabel =
      type === 'mr'
        ? translate('components.taskUrlPreview.gitlabMergeRequest', 'GitLab merge request')
        : translate('components.taskUrlPreview.gitlabIssue', 'GitLab issue')
    const identifier = type === 'mr' ? `!${number}` : `#${number}`
    return {
      provider: 'gitlab',
      identifier,
      subtitle: project,
      kindLabel,
      createLabel:
        type === 'mr'
          ? translate(
              'components.taskUrlPreview.gitlabMergeRequestCreateLabel',
              'Create worktree from GitLab merge request {{identifier}}',
              { identifier: `${project}${identifier}` }
            )
          : translate(
              'components.taskUrlPreview.gitlabIssueCreateLabel',
              'Create worktree from GitLab issue {{identifier}}',
              { identifier: `${project}${identifier}` }
            )
    }
  }
  return {
    provider: 'jira',
    identifier: intent.parsed.issueKey,
    subtitle: intent.parsed.origin.replace(/^https?:\/\//, ''),
    kindLabel: translate('auto.components.JiraIssueWorkspace.ef21405c6d', 'Jira issue'),
    createLabel: translate(
      'components.taskUrlPreview.jiraIssueCreateLabel',
      'Create worktree from Jira issue {{identifier}}',
      { identifier: intent.parsed.issueKey }
    )
  }
}
