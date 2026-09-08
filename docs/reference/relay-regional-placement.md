# Relay placement: Hive product boundary

HiveCode uses account-authorized HiveRelay tickets and the Fleet/control-plane assignment.
The active host implementation is `src/main/hive-runtime-cloud/relay-host/`; the client uses account runtime
transport. The old `src/main/runtime/relay/` broker and mobile invite-based transport are
retired. Their regional latency cache and `ORCA_RELAY_REGION_OVERRIDE` do not configure
HiveRelay placement.

## Upstream review (2026-09-08)

Upstream Orca added warm-up health probes, minimum-of-three latency selection, bounded
no-hint caching, and assigned-cell cache invalidation to its invite-based director flow.
Those fixes depend on the retired broker, its region catalog, and the old assignment
request. They must not be reconnected to Hive account transport as a conflict resolution.
In particular, `us-central1` and `asia-east2` are upstream deployment choices, not Hive
production defaults.

Hive placement changes must follow the HiveRelay Fleet activation and ticket-generation
contracts. See `upstream-sync-20260908-resolution.md` for protocol review and local test
evidence; this review does not claim cross-region production latency testing.
