# Relay region correction architecture

This compatibility reference follows the maintained [product design](../engineering/product-design.md). It describes the imported idle-cutover implementation; it does not enable Hive production infrastructure. Candidate tests, platform gaps and publication decisions are recorded under `logs/upstream-sync-20260912`.

The existing regional worker may select a faster target only when the source owns no live or pending relay clients. Quiet sockets still count as clients. Direct LAN sessions and running terminal processes do not by themselves count as relay clients. Continuous clients can postpone optional optimization indefinitely.

The source owns an admission barrier covering accepts, attaches, credential changes and control replacement. Ownership is recorded before the first asynchronous operation. A busy attempt releases the barrier and defers without consuming the durable dispatch-failure budget. The director uses rotating candidate pages so busy hosts do not starve idle candidates.

The authenticated command carries director cohort and safety evidence. The source combines that evidence with its own process snapshot, then rechecks current assignment, epoch, incarnation, capacity, cohort and target safety within the existing constrained assignment transaction. Stable operation identity is derived from exact source authority and target. Retries do not invent a second migration engine.

Ambiguous timeout or lost replies require locked reconciliation before admissions reopen. Late callbacks remain fenced by operation identity and source generation. A successful idle move uses ordinary desktop and mobile reconnect; it does not retain or transfer old physical data connections and never blindly replays a sent mutation.

Fresh measurements compare the actual incumbent with the proposed target. The target must improve latency by at least 25 ms and 20 percent. Inconclusive, expired, stale-basis or unsupported evidence cannot authorize a move. Unsupported participants retain their prior assignment; old servers keep the existing negotiated request fallback.

Disabling optional correction stops new attempts while accepted operations still reconcile. Emergency drains, authentication expiry and revocation keep their existing enforcement and hard deadlines. A foreground phone becoming quiet is not proof of a disconnection; source-owned connection state is authoritative.

Verification must cover admission/attach races, quiet clients, replacement controls, duplicate workers, lost transaction replies, target failure, explicit busy deferral, mixed versions and append-once mutations. PostgreSQL concurrency, physical-device background timing, packaged Linux/Windows execution and measured end-user benefit need separate evidence. Imported upstream acceptance records are historical references rather than fresh Hive validation.
