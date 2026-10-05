import { applyProductCliBranding } from '../../shared/brand'
import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const REPO_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['repo', 'list'],
    summary: applyProductCliBranding('List repos registered in Orca'),
    usage: applyProductCliBranding('orca repo list [--json]'),
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['repo', 'add'],
    summary: applyProductCliBranding('Add a project to Orca by filesystem path'),
    usage: applyProductCliBranding('orca repo add --path <path> [--json]'),
    allowedFlags: [...GLOBAL_FLAGS, 'path']
  },
  {
    path: ['repo', 'show'],
    summary: 'Show one registered repo',
    usage: applyProductCliBranding('orca repo show --repo <selector> [--json]'),
    allowedFlags: [...GLOBAL_FLAGS, 'repo']
  },
  {
    path: ['repo', 'set'],
    summary: applyProductCliBranding('Set whether non-Orca worktrees are shown for a repo'),
    usage: applyProductCliBranding(
      'orca repo set --repo <selector> --external-worktree-visibility show|hide|inherit [--json]'
    ),
    allowedFlags: [...GLOBAL_FLAGS, 'repo', 'external-worktree-visibility'],
    notes: [
      applyProductCliBranding(
        'show and hide override the global non-Orca worktree visibility default for this repo; inherit clears the override.'
      ),
      'Per-worktree visibility rules still apply.'
    ],
    examples: [
      applyProductCliBranding(
        'orca repo set --repo path:/path/to/repo --external-worktree-visibility show --json'
      )
    ]
  },
  {
    path: ['repo', 'set-base-ref'],
    summary: "Set the repo's default base ref for future worktrees",
    usage: applyProductCliBranding('orca repo set-base-ref --repo <selector> --ref <ref> [--json]'),
    allowedFlags: [...GLOBAL_FLAGS, 'repo', 'ref']
  },
  {
    path: ['repo', 'search-refs'],
    summary: 'Search branch/tag refs within a repo',
    usage: applyProductCliBranding(
      'orca repo search-refs --repo <selector> --query <text> [--limit <n>] [--json]'
    ),
    allowedFlags: [...GLOBAL_FLAGS, 'repo', 'query', 'limit']
  }
]
