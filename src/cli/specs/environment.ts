import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const ENVIRONMENT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['host', 'list'],
    summary: 'List every machine this HiveCode host can target, and how to name each one',
    usage: 'hive host list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Answers "what can I target and what do I pass" in one place: this machine, the SSH targets registered on it, and the HiveCode servers paired with it.',
      'The three kinds are reached differently. A paired HiveCode server is a connection, selected with --environment <name>. An SSH target is a machine the connected HiveCode host reaches, selected with --host ssh:<id>. Passing one where the other belongs is the most common way to get an empty or missing-host answer.',
      "SSH targets are read from the HiveCode host you are currently connected to, so this lists that host's targets and not another server's."
    ],
    examples: ['hive host list', 'hive host list --json']
  },
  {
    path: ['environment', 'add'],
    summary: 'Save a remote HiveCode runtime environment from a pairing code',
    usage: 'hive environment add --name <name> --pairing-code <code> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'name'],
    examples: [
      'hivecode environment add --name work-laptop --pairing-code hivecode://pair?code=...'
    ]
  },
  {
    path: ['environment', 'list'],
    summary: 'List saved HiveCode runtime environments',
    usage: 'hive environment list [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['environment', 'show'],
    summary: 'Show one saved HiveCode runtime environment',
    usage: 'hive environment show --environment <selector> [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['environment', 'rm'],
    destructive: true,
    summary: 'Remove one saved HiveCode runtime environment',
    usage: 'hive environment rm --environment <selector> [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  }
]
