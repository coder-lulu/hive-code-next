import { GLOBAL_FLAGS, type CommandSpec } from '../args'

export const RUNTIME_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['runtime', 'status'],
    summary: "Show this installation's Hive account ownership and presence state",
    usage: 'hive runtime status [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Always targets the Runtime on this machine. Local anonymous pairing remains independent.'
    ],
    examples: ['hive runtime status', 'hive runtime status --json']
  },
  {
    path: ['runtime', 'claim'],
    summary: 'Claim this Runtime installation to a Hive account',
    usage: 'hive runtime claim [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Prints a verification URL and user code. By default, waits until the account approves the claim.',
      'Claiming does not replace or remove local anonymous pairing.'
    ],
    examples: ['hive runtime claim', 'hive runtime claim --json']
  },
  {
    path: ['runtime', 'reset-cloud-identity'],
    destructive: true,
    summary: "Reset only this installation's Hive Cloud identity",
    usage: 'hive runtime reset-cloud-identity [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Clears the local Cloud installation identity and registration state.',
      'Does not remove local pairing, paired devices, projects, worktrees, or account-owned directory records.'
    ],
    examples: ['hive runtime reset-cloud-identity']
  }
]
