import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const AGENT_HOOK_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['agent', 'hooks', 'prepare-codex'],
    summary: 'Repair HiveCode-managed Codex hook trust before a shell launch',
    usage: 'hive agent hooks prepare-codex',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['agent', 'hooks', 'status'],
    summary: 'Show whether HiveCode-managed agent status hooks are enabled',
    usage: 'hive agent hooks status [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['hive agent hooks status', 'hive agent hooks status --json']
  },
  {
    path: ['agent', 'hooks', 'off'],
    summary: 'Disable HiveCode-managed agent status hooks and remove local hook entries',
    usage: 'hive agent hooks off [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['hive agent hooks off']
  },
  {
    path: ['agent', 'hooks', 'on'],
    summary: 'Enable HiveCode-managed agent status hooks',
    usage: 'hive agent hooks on [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['hive agent hooks on']
  }
]
