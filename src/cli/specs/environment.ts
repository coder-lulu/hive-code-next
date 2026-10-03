import { applyProductBranding } from '../../shared/brand'
import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const ENVIRONMENT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['host', 'name'],
    summary: applyProductBranding(
      'Show or set the name this Orca runtime reports to connected clients'
    ),
    usage: 'orca host name [--name <name>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'name'],
    notes: [
      'With --name, updates the answering runtime over its authenticated connection. Use an empty value to return to the detected computer name.',
      'Without --name, prints the name and platform the answering runtime reports.'
    ],
    examples: ['orca host name', 'orca host name --name build-server']
  },
  {
    path: ['host', 'list'],
    summary: 'List every machine this HiveCode host can target, and how to name each one',
    usage: 'hive host list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Answers "what can I target and what do I pass" in one place: this machine, the SSH targets registered on it, and the HiveCode servers paired with it.',
      'The three kinds are reached differently. A paired HiveCode server is a connection, selected with --environment <name>. An SSH target is a machine the connected HiveCode host reaches, selected with --host ssh:<id>. Passing one where the other belongs is the most common way to get an empty or missing-host answer.',
      'SSH rows include the detected remote platform after that target has connected (linux, darwin, or win32); disconnected or older targets report platform unknown.',
      'SSH rows also include whether the target is currently connected and its lifecycle status when known.',
      'Paired-server rows come from the pairing store and report platform unknown; ask one server directly with `orca host name --environment <name>`.',
      "SSH targets are read from this machine's own HiveCode runtime, so this lists that machine's targets and not another server's. Run `hive host list` on the other machine to see the targets registered there.",
      '--environment and --pairing-code are rejected rather than ignored: paired servers come from this machine\u2019s pairing store, so a routed answer would describe two machines at once.'
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
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Answers from this machine\u2019s pairing store. --environment and --pairing-code are rejected rather than ignored, because there is no other host that could answer.'
    ]
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
