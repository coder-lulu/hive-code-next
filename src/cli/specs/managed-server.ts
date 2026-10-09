import { APP_DISPLAY_NAME, PRIMARY_CLI_COMMAND } from '../../shared/brand'
import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

const SELECTOR_NOTE = `--environment names a managed ${APP_DISPLAY_NAME} server this machine deployed over SSH (see \`${PRIMARY_CLI_COMMAND} environment list\`); it is a selector here, not a routing flag.`
const DESKTOP_NOTE = `Runs on this machine’s ${APP_DISPLAY_NAME} desktop app, the same action as Settings > Managed servers. A runtime without the SSH registry (headless \`${PRIMARY_CLI_COMMAND} serve\`) refuses it.`

export const MANAGED_SERVER_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['environment', 'status'],
    summary: `Show a managed ${APP_DISPLAY_NAME} server’s active version, terminals and pending work`,
    usage: `${PRIMARY_CLI_COMMAND} environment status --environment <selector> [--json]`,
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [SELECTOR_NOTE, DESKTOP_NOTE],
    examples: [`${PRIMARY_CLI_COMMAND} environment status --environment build-box`]
  },
  {
    path: ['environment', 'update'],
    summary: `Update a managed ${APP_DISPLAY_NAME} server to this build’s version`,
    usage: `${PRIMARY_CLI_COMMAND} environment update --environment <selector> [--force] [--json]`,
    allowedFlags: [...GLOBAL_FLAGS, 'force'],
    notes: [
      'Without --force, an update that would restart over running terminals is deferred and reported, not applied.',
      SELECTOR_NOTE,
      DESKTOP_NOTE
    ],
    examples: [`${PRIMARY_CLI_COMMAND} environment update --environment build-box`]
  },
  {
    path: ['environment', 'rollback'],
    summary: `Roll a managed ${APP_DISPLAY_NAME} server back to its previous version`,
    usage: `${PRIMARY_CLI_COMMAND} environment rollback --environment <selector> [--json]`,
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [SELECTOR_NOTE, DESKTOP_NOTE]
  },
  {
    path: ['environment', 'recover'],
    summary: `Finish or undo a managed ${APP_DISPLAY_NAME} server’s interrupted update, rollback or stop`,
    usage: `${PRIMARY_CLI_COMMAND} environment recover --environment <selector> [--accept-changed-state --yes] [--json]`,
    allowedFlags: [...GLOBAL_FLAGS, 'accept-changed-state', 'yes'],
    notes: [
      'When a rejected build changed profile state, recover refuses rather than restart the previous build over it. --accept-changed-state --yes restores the prelaunch snapshot instead, the same as Restore in Settings > Managed servers; what the rejected build changed is discarded.',
      SELECTOR_NOTE,
      DESKTOP_NOTE
    ],
    examples: [
      `${PRIMARY_CLI_COMMAND} environment recover --environment build-box`,
      `${PRIMARY_CLI_COMMAND} environment recover --environment build-box --accept-changed-state --yes`
    ]
  },
  {
    path: ['environment', 'stop'],
    destructive: true,
    summary: `Stop a managed ${APP_DISPLAY_NAME} server and unlink it from this machine (decommission)`,
    usage: `${PRIMARY_CLI_COMMAND} environment stop --environment <selector> --yes [--json]`,
    allowedFlags: [...GLOBAL_FLAGS, 'yes'],
    notes: [
      'Stops orcad on the SSH host and, once the host proves it exited, removes the server from this machine. Its terminals end. Requires --yes.',
      'If the host cannot prove orcad exited, the server stays linked and the refusal says why; nothing is removed on a guess.',
      `Pick another Active Server first if this one is active. \`${PRIMARY_CLI_COMMAND} environment cancel-stop\` withdraws a stop orcad has not acted on yet.`,
      SELECTOR_NOTE,
      DESKTOP_NOTE
    ],
    examples: [`${PRIMARY_CLI_COMMAND} environment stop --environment build-box --yes`]
  },
  {
    path: ['environment', 'cancel-stop'],
    summary: `Withdraw a managed ${APP_DISPLAY_NAME} server stop that orcad has not acted on yet`,
    usage: `${PRIMARY_CLI_COMMAND} environment cancel-stop --environment <selector> [--json]`,
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [SELECTOR_NOTE, DESKTOP_NOTE]
  }
]
