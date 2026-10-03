# Cloud Push Gateway

This workspace contains the mobile push gateway and its contract package. The
gateway is retained upstream reference code, isolated from Hive production.
Hive notifications use HiveCloud's owned service. This workspace is separate
from the Hive desktop Relay runtime.

## Packages

- `apps/push`: the push gateway service.
- `packages/push-contract`: the gateway wire contract.

Run commands from `cloud/`, not the repository root. The source is covered by
the repository's root [MIT license](../LICENSE).

## Mobile push gateway

The desktop host authenticates with its existing X25519 key, answers an
encrypted challenge, and registers each paired phone's native push token. The
gateway queues notification events and sends them through APNs or FCM. It
enforces per-host quotas and request limits and retires registrations reported
as unregistered by the provider.

Configure `ORCA_PUSH_PUBLIC_URL`, `ORCA_PUSH_FCM_PROJECT_ID`,
`ORCA_PUSH_DATABASE_URL`, and the three APNs variables
(`ORCA_PUSH_APNS_KEY`, `ORCA_PUSH_APNS_KEY_ID`, `ORCA_PUSH_APPLE_TEAM_ID`, all
three or none). The FCM credential comes from the runtime service account.
See [push gateway operations](docs/push-gateway.md).

Logging contains aggregate counters only. Tokens, notification content, and
full host fingerprints are never logged.

## Infrastructure and operations

- `infra/terraform`: the Push gateway and its dedicated database. Local
  formatting and backend-free validation remain available; repository
  plan/apply commands are blocked until the legacy state is separated.
- `dev/scripts`: Push deployment and validation helpers plus their contract
  tests. Run them with `pnpm test`.
- `docs/`: Push gateway operations and workflow documentation.

Production deployment is performed only by `.github/workflows/cloud-push-deploy.yml`.
It requires the production environment Workload Identity variables, a reviewed
40-character `source_sha`, the `DEPLOY_PUSH_GATEWAY` confirmation, the `main`
branch, the exact `stablyai/orca` repository, and `ORCA_CLOUD_OPERATIONS_ENABLED=true`.
The job cannot run in the Hive repository even if that variable is set. Local `pnpm build` and
`pnpm test` do not deploy or modify cloud resources.

The old Orca Cloud Relay application and its deployment workflows are no
longer part of this workspace. Existing Terraform state that refers to that
service must be reviewed and migrated deliberately; do not run Terraform
plan or apply against the old state until the state owner has
inspected and migrated the state and confirmed the current root partition.

## Local development

```sh
cd cloud
pnpm install
pnpm build
pnpm test
```

Push tests use SQLite by default. PostgreSQL checks require a disposable
database configured through the test command or environment documented by the
individual test.
