# Orca mobile push gateway

`orca-cloud-push` is a public Cloud Run service in `onorca-cloud` that turns a desktop
notification into an APNs or FCM push for a paired phone. The desktop registers each phone's
native token with it and calls `POST /v1/send` after the socket fan-out it already does; the
phone treats APNs/FCM as the sole ordinary OS-banner path. The notification socket is retained only
for live dismissal and reconnect tray reconciliation; it does not create or recover banners. Desktop
notification categories remain authoritative. The service is the only place the Apple
`.p8` signing key is readable, which is the reason it exists as a service at all.

The request schemas live in `packages/push-contract/src/`. This document covers Terraform
ownership, deployment, credential rotation, and recovery.

**There is no staging push gateway.** That is a decision, not an omission. `push_gateway_enabled`
is false in `environments/staging.tfvars` and true in `environments/production.tfvars`, and every
resource in `infra/terraform/push-gateway.tf` is behind it. A staging gateway would be a tfvars
edit plus a second set of Apple credentials.

## Shape

| Setting           | Value                                                  | Where                                        |
| ----------------- | ------------------------------------------------------ | -------------------------------------------- |
| Cloud Run service | `orca-cloud-push`                                      | `push_cloud_run_service_name`                |
| Region            | `us-central1`                                          | `region`                                     |
| Instances         | min 1, max 2                                           | `push_min_instances`, `push_max_instances`   |
| Database pool     | 6 per instance                                         | `push_database_pool_max`                     |
| Concurrency       | 80                                                     | `push_concurrency`                           |
| Ingress           | all                                                    | `INGRESS_TRAFFIC_ALL`                        |
| Invoker           | IAM disabled                                           | `invoker_iam_disabled = true` on the service |
| Runtime identity  | `orca-cloud-push@onorca-cloud.iam.gserviceaccount.com` | `google_service_account.push_runtime`        |
| Database          | `orca_push` on dedicated HA PostgreSQL 17           | `google_sql_database.push_dedicated`                   |
| Hostname          | `push.onorca.dev`                                      | `push_base_url`                              |

The minimum of one instance is deliberate and did not move when the ceiling came down to two. A
cold start delays a notification past the point where it is worth showing, so the floor is what
keeps a notification prompt. The
ceiling is a different question, answered below.

Push uses its approved dedicated two-vCPU HA database. Two instances with a two-connection
pool draw twelve connections; three simultaneous revision resources draw thirty-six. Tagged
candidates can run outside the service-wide cap, so Terraform bounds instances × pool × 3
at 64 connections, leaving dedicated capacity for maintenance and operators. Increase pool
sizes only after measuring contention. The retired shared Cloud Relay budget excludes Push entirely.
Any legacy state containing shared Relay resources requires separate owner review before planning or applying changes.

Authentication is the host proof in `POST /v1/host/challenge`, not Cloud Run IAM, so the service
opts out of invoker IAM with `invoker_iam_disabled = true`, exactly as the relay director does.
The project's domain-restricted-sharing policy refuses an `allUsers` invoker binding, so that is
the only way to reach an open service here.

## Environment

Set on the container by Terraform:

| Variable                      | Source                                                   |
| ----------------------------- | -------------------------------------------------------- |
| `PORT`                        | Cloud Run, container port 8080                           |
| `ORCA_PUSH_PUBLIC_URL`        | `push_base_url`                                          |
| `ORCA_PUSH_FCM_PROJECT_ID`    | `project_id` (required for standalone runtime)          |
| `ORCA_PUSH_DATABASE_URL`      | Secret `orca-cloud-push-dedicated-database-url`, pinned version  |
| `ORCA_PUSH_DATABASE_POOL_MAX` | `push_database_pool_max`, 6 per instance                 |
| `ORCA_PUSH_APNS_KEY`          | Secret `orca-cloud-push-apns-key`, version `latest`      |
| `ORCA_PUSH_APNS_KEY_ID`       | Secret `orca-cloud-push-apns-key-id`, version `latest`   |
| `ORCA_PUSH_APPLE_TEAM_ID`     | Secret `orca-cloud-push-apple-team-id`, version `latest` |

`ORCA_PUSH_APNS_TOPIC` is left to its application default (`com.stably.orca.mobile`). Add it here
only when it has to differ from the code default, so that a code-side change stays visible rather
than silently overridden.

Terraform owns the three Apple secret **names, labels, and replication, and never a version.**
The `.p8` is issued by the Apple developer portal, so a Terraform-managed version would put the
private key in state and would fight the rotation below. The database URL secret is different:
Terraform generates that password, so it owns that version through the dedicated Push database
resources in `infra/terraform/push-gateway.tf`.
That puts the generated password and the full database URL in the state bucket, which the shared
deploy identity can read; the Apple key never appears there. The three Apple secrets and the
`orca_push` database carry `prevent_destroy`, so disabling the gateway fails the plan instead
of deleting the only copy of the signing key or every live device token.

## Importing what already exists

The runtime account, the three Apple secrets, and their accessor bindings were created out of
band alongside the Apple credentials. They are declared so a plan is clean, and imported once.
Run these from `cloud/` after `pnpm infra:init --env production`, review the resulting plan, and
expect the imported resources to show no changes.

```sh
terraform -chdir=infra/terraform import -var-file=environments/production.tfvars \
  'google_service_account.push_runtime[0]' \
  projects/onorca-cloud/serviceAccounts/orca-cloud-push@onorca-cloud.iam.gserviceaccount.com

terraform -chdir=infra/terraform import -var-file=environments/production.tfvars \
  'google_project_iam_member.push_runtime_fcm_admin[0]' \
  'onorca-cloud roles/firebasecloudmessaging.admin serviceAccount:orca-cloud-push@onorca-cloud.iam.gserviceaccount.com'

terraform -chdir=infra/terraform import -var-file=environments/production.tfvars \
  'google_project_iam_member.push_runtime_service_usage_consumer[0]' \
  'onorca-cloud roles/serviceusage.serviceUsageConsumer serviceAccount:orca-cloud-push@onorca-cloud.iam.gserviceaccount.com'

terraform -chdir=infra/terraform import -var-file=environments/production.tfvars \
  'google_secret_manager_secret.push_provider["orca-cloud-push-apns-key"]' \
  projects/onorca-cloud/secrets/orca-cloud-push-apns-key

terraform -chdir=infra/terraform import -var-file=environments/production.tfvars \
  'google_secret_manager_secret.push_provider["orca-cloud-push-apns-key-id"]' \
  projects/onorca-cloud/secrets/orca-cloud-push-apns-key-id

terraform -chdir=infra/terraform import -var-file=environments/production.tfvars \
  'google_secret_manager_secret.push_provider["orca-cloud-push-apple-team-id"]' \
  projects/onorca-cloud/secrets/orca-cloud-push-apple-team-id

terraform -chdir=infra/terraform import -var-file=environments/production.tfvars \
  'google_secret_manager_secret_iam_member.push_provider_runtime_accessor["orca-cloud-push-apns-key"]' \
  'projects/onorca-cloud/secrets/orca-cloud-push-apns-key roles/secretmanager.secretAccessor serviceAccount:orca-cloud-push@onorca-cloud.iam.gserviceaccount.com'

terraform -chdir=infra/terraform import -var-file=environments/production.tfvars \
  'google_secret_manager_secret_iam_member.push_provider_runtime_accessor["orca-cloud-push-apns-key-id"]' \
  'projects/onorca-cloud/secrets/orca-cloud-push-apns-key-id roles/secretmanager.secretAccessor serviceAccount:orca-cloud-push@onorca-cloud.iam.gserviceaccount.com'

terraform -chdir=infra/terraform import -var-file=environments/production.tfvars \
  'google_secret_manager_secret_iam_member.push_provider_runtime_accessor["orca-cloud-push-apple-team-id"]' \
  'projects/onorca-cloud/secrets/orca-cloud-push-apple-team-id roles/secretmanager.secretAccessor serviceAccount:orca-cloud-push@onorca-cloud.iam.gserviceaccount.com'
```

The push resources already exist in production. Preserve their addresses, dedicated database
and identities; review the [database cleanup runbook](./push-database-cutover.md) before applying
changes. This root has unrelated standing drift, so an untargeted apply is never automatic.

Two things this root does **not** declare, because the carve assigns them elsewhere. Neither
affects whether this root's plan is clean, since an undeclared resource is invisible to it.

- `firebase.googleapis.com` and `fcm.googleapis.com` are project service enablement, which is
  `google_project_service.required` in the foundation root. They are already enabled; add them
  to the foundation root's list so a foundation plan stays clean.
- The Firebase attachment on `onorca-cloud` is project-level and belongs with foundation for the
  same reason. It exists already.

## Deploying

Deploy Push Gateway Production is an upstream reference workflow restricted to `stablyai/orca`.
It cannot run in the Hive repository. In the upstream repository it runs from main only after
ORCA_CLOUD_OPERATIONS_ENABLED is true and the dispatcher supplies DEPLOY_PUSH_GATEWAY. It uses the
dedicated Push Workload Identity provider and service account, a Push-only concurrency group, and
the production-push-rollout lease object. It does not apply Terraform. Terraform plan/apply from
this repository is disabled until the legacy shared state has been reviewed and separated.

The workflow builds the selected source revision, publishes an image, resolves its Artifact
Registry digest, and deploys that immutable image as a tagged candidate with no traffic. Before
candidate creation it records the serving revision, its image, and its Terraform-owned scaling.
It then checks the candidate image and scaling, probes its /ready and /health endpoints, and makes
a validate-only FCM request with the runtime identity. It shifts traffic to the candidate only
after those checks succeed. The rollout summary records the previous revision and image before
the public-origin check.

If the public-origin check fails after traffic moves, the workflow attempts to restore traffic
to the previous revision. It deletes a rejected candidate only after the rollback is confirmed,
and removes its temporary traffic tag. A deployment may still have run startup schema changes or
queue workers before the HTTP shift; restoring traffic does not undo those side effects. An
interrupted run or failed cleanup needs operator review of live revisions, traffic, database
connections, and the workflow log before another dispatch.

The current workflow does not run an inert validation revision or automatically create a
known-good successor during recovery. Do not use the former three-revision recovery commands
for this workflow. Keep schema changes compatible with the previous serving revision and review
the dedicated Push connection budget before raising instance or pool limits.
### Incompatible queue rollout prerequisite

The queue stores one notification object per delivery. Before deploying a revision that changes this
format, stop every older push gateway revision and clear only unpublished push delivery fixtures from
the push database. This is an unpublished feature, so do not preserve or migrate queued fixtures; no
production mutation is implied by this prerequisite.

### Why the FCM probe impersonates the runtime account

A gateway that boots and answers `/ready` can still be unable to send: the FCM grant lives on
the runtime service account, not on anything the readiness check touches. The probe therefore
mints an access token for `orca-cloud-push@onorca-cloud.iam.gserviceaccount.com` and posts
`validate_only: true` with a token that cannot exist. `validate_only` stops Google before any
delivery, and a healthy credential answers `INVALID_ARGUMENT` because the device token is
garbage. `PERMISSION_DENIED`, `401`, and `403` are the failures the step exists to catch, and
they fail the run immediately, before traffic moves. Those four answers are the only conclusive
ones: a `429`, a `5xx`, or a transport failure says nothing about the credential, so the send is
retried up to five times at five-second intervals rather than read as either verdict. Probing as the deploy identity instead would prove
something true about the wrong account.

## Rotating the APNs key

Apple keys do not expire, so this is for a suspected compromise or a routine rotation. Order
matters: the new key must be serving before the old one is revoked, or every iOS push fails in
the window between.

1. In the Apple developer portal, create a **new** APNs authentication key. Download the `.p8`
   once; Apple will not show it again. Note the new key ID. A team may hold two APNs keys at a
   time, which is what makes this overlap possible.
2. Add a version to each changed secret, without printing the value:

   ```sh
   gcloud secrets versions add orca-cloud-push-apns-key \
     --project onorca-cloud --data-file /path/to/AuthKey_NEW.p8
   printf '%s' '<new key id>' | gcloud secrets versions add orca-cloud-push-apns-key-id \
     --project onorca-cloud --data-file=-
   ```

   The team ID does not change, so `orca-cloud-push-apple-team-id` is untouched.

3. Dispatch `Deploy Push Gateway Production`. The container reads `latest` at start, so only a
   new revision picks the key up; there is no in-place reload.
4. Verify from a real device that an iOS notification still arrives. The workflow's FCM probe
   covers Android only, and APNs has no validate-only equivalent.
5. Only then revoke the old key in the Apple portal, and disable the superseded secret versions:

   ```sh
   gcloud secrets versions disable <old-version> \
     --project onorca-cloud --secret orca-cloud-push-apns-key
   ```

   Disable rather than destroy, so a rollback to the previous revision still works. Destroy
   after the next clean deploy.

Delete the downloaded `.p8` from disk when you are done. It is the whole credential.

## Dead tokens

A push token stops working when the app is uninstalled, when the user restores to a new device,
or when iOS reissues it. Both providers report this, and the shapes differ:

- APNs: HTTP 410, or 400 with `BadDeviceToken` or `Unregistered`.
  `DeviceTokenNotForTopic` is a provider configuration error and leaves the registration live.
  Check the APNs topic and environment; future notifications can resume after correction without
  phone re-registration. The failed notification is not retried for this non-transient error.
- FCM: `UNREGISTERED`, or `INVALID_ARGUMENT` whose message names the token.

The gateway marks the registration `dead_at` and returns `status: "dead"` for it, and the
desktop drops the registration when it sees that. Nothing here retries a dead token. A phone
that comes back re-registers the same host/device pair, retaining its `registrationId` and
clearing `dead_at`. The per-minute `delivery_dead` counter measures delivery outcomes, not
currently dead registrations. A spike across many hosts warrants checking credentials and topics.

## Quotas

Two independent limits, both enforced in the gateway and both returning HTTP 200 with
`status: "rate_limited"` per result rather than failing the request:

| Limit                                         | Scope                                   |
| --------------------------------------------- | --------------------------------------- |
| 300 logical alerts per rolling 15 minutes     | per `hostFingerprint`                   |
| 300 logical dismissals per rolling 15 minutes | per `hostFingerprint`, separate budget  |
| 20 `registrationIds`                          | per request, hard cap, HTTP 400 over it |

Fanout to several phones counts one logical event; there is no per-phone daily allowance.
Unauthenticated handshakes and invalid bearer attempts have separate 30/minute IP buckets.
Authenticated routes use a 600/minute host bucket and a shared 6,000/minute client-IP bucket
per instance. The IP budget cannot be reset by generating another host key. It is shared by
clients behind one NAT and is an abuse safeguard, not a global provider-spending cap. Auth database lookup concurrency
and waiting work are bounded independently of HTTP concurrency.

`push_events` backs quota accounting. `push_event_recipients` deduplicates fanout and
`push_delivery_batches` retains its historical name and persists individual pending deliveries,
worker leases and retries. A delivery row is deleted when it is sent, dead, dismissed or expired, so
the table holds only live work. Event and recipient identity metadata is retained for 24 hours.
Payloads expire within five minutes. Minute-level cleanup deletes in bounded batches, so a backlog
drains over successive runs instead of in one long statement. FCM project-level provider quotas
remain independent of host limits.

The source configuration now uses six database connections per instance and twelve delivery drains. The claim-attempt budget follows the drain count so every peer can hold a device head without exhausting another claim. These are reviewed source settings; local tests do not establish that a production deployment has applied them.

A worker claims one device's oldest due delivery with a row lock that other claimers skip, and a
non-blocking per-device lock keeps at most one delivery per phone in flight. Each claim also takes
the previous revision's global claim lock in shared mode, so during a deploy overlap an old worker's
claim waits for new leases to commit instead of re-leasing them. That shared lock can be removed one
release after every worker runs this revision. The claim scan only
reads rows due within the notification TTL, so an unpruned backlog does not slow it. Boot adds one
queue index, a partial index of pending rows per device for the head check; it indexes no lease
column, so lease and renew writes stay heap-only updates. Claim, finish and cleanup traffic may
hold at most one fewer connection than the pool size, so request authentication always has a
connection. Lease renewals skip that cap so they never queue behind claims.

Logging is aggregate counters only. Never log a token, a title, a body, or a full fingerprint;
the first four characters of a fingerprint are the most that may appear.

## DNS: one hand-managed record

The Cloud Run domain mapping is created here, and Google issues and renews the certificate. The
`onorca.dev` zone is not in this root: it is a Cloudflare zone whose Terraform-managed records
live in the apps root in `stablyai/orca-cloud`, and whose relay and auth records are managed by
hand. The push record follows the relay's precedent and was created by hand on 2026-09-04:

```text
push.onorca.dev.  CNAME  ghs.googlehosted.com.   (DNS only, not proxied)
```

`terraform -chdir=infra/terraform output push_dns_record` prints the same three fields. If the
record is ever lost, recreate it exactly like that; Cloudflare proxying blocks certificate
issuance and breaks Cloud Run host routing.

### Recovery and delivery guarantees

The workflow records the candidate tag and revision before deployment and the rollback revision
before changing traffic. A failed public check after the shift triggers a rollback attempt;
candidate deletion requires confirmed rollback. Manual review is required when a run is
interrupted or cleanup fails. Startup schema changes and delivered notifications are not
reversed by traffic rollback.

Push uses the relay's schema-startup retry implementation through `@orca-cloud/postgres-schema`.
Session replacement is serialized per host and a unique host index upgrades older databases by
retaining their newest session. Cloud Verify runs push concurrency tests against PostgreSQL.

Accepted sends commit quota and pending work together before returning `queued`. Workers resume
unfinished deliveries after restarts without relying on desktop retries. The durable queue and
expiring leases coordinate replicas. All provider attempts retain the original five-minute deadline
and respect provider backoff; no retry extends alert life. Silent dismissal messages have their own
quota and cancel matching unsent alerts. Mobile OS delivery/execution is not guaranteed.

Shutdown stops admission and new claims; unfinished leases remain recoverable. Provider acceptance
and SQL completion cannot be atomic, so repeated transport delivery remains possible after a crash.
Stable per-event replacement identities reduce duplicates without promising exactly-once visible
delivery. FCM notification messages are inherently collapsible while offline and support only a
small number of concurrent collapse keys per device, so excess pending messages may be discarded and
every offline alert is not guaranteed to appear. Socket reconnect reconciles dismissals against the
current native tray; it has no stored replay watermark and never recovers a missed OS banner.

### Dedicated database operations

Push has one dedicated database attachment, with stable Terraform addresses and deletion
protection. There is no switch to shared storage. Follow the [database operations runbook](./push-database-cutover.md)
for deployment prerequisites, legacy resource ownership, capacity and recovery.
