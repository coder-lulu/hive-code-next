# Paperclip integration patch boundary

The fixed source revision and audit hashes are in
[`compatibility-manifest.json`](../compatibility-manifest.json). The P1 adapter
package builds with `pnpm run build:paperclip-adapter`, and the authenticated host
binding producer is installed. The current P1 [restricted task service](../service/README.md)
uses the pinned database schema and migrations without importing upstream server
or Provider code. Its minimal image has been built; Windows development runs the
same entry on host Node. No upstream server patches have been applied. This
directory specifies the boundaries required before incorporating that server.

The upstream server must remain unavailable until the following boundaries are
patched and verified against the pinned source. The restricted P1 distribution
enforces its own exact route allowlist and build-input exclusions. A disabled
adapter menu is insufficient.

| Boundary                                             | Required integration change                                                                                                                                                                       | Verification owner |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Adapter registry                                     | Only `hive_runtime`; unknown types fail, including paused/plugin fallback; exclude local Provider/runner packages from the sidecar                                                                | P1-T01/T08         |
| Agent create/update/import/wakeup and final dispatch | Resolve Hive profile/version from trusted bindings; reject command/env/model/provider configuration and unbound roles                                                                             | P1-T08             |
| Pre-adapter workspace preparation                    | Skip Paperclip workspace materialization, Git synchronization, managed MCP, secrets, skills and instruction preparation for Hive execution; Runtime owns actual paths                             | P1-T08             |
| CompanySkills/SkillStudio and implicit execution     | Reject original resource writes, imports, installs, test runs, test cancellation and Provider writes; audit eval/watchdog/implicit LLM dispatch directly                                          | P1-T08, P3-T04/T15 |
| Adapter execution                                    | Use Gateway and existing Runtime replay admission; register cancellation readiness; dispatch only after durable binding; wait for host terminal receipt; no HTTP-202 completion or fabricated PID | P1-T02/T03/T07     |
| External execution recovery                          | Startup, periodic reaper, drain/upgrade and cancel resolve durable Hive execution before local orphan cleanup; unknown stays active and does not relaunch                                         | P2-T05             |
| Identity                                             | Product access only through authenticated Hive facade with actor/object authorization; no second user login or broad key in Agent                                                                 | P2 base: P3-T02/T03/T04 |
| Cost projection                                      | Unique source event/revision and cumulative correction; unknown facts stored separately; New API alone charges                                                                                    | P1-T10, P5-T08/T09 |
| Telemetry and logs                                   | Do not send task content or telemetry upstream without product authorization; bounded internal diagnostics omit private content and credentials                                                   | P1-T01/T08         |

Recipe for an upstream-server distribution: build the **single pinned revision**, apply the above
patch set, install only the audited runtime adapter, copy upstream MIT license
and third-party notices, use a separate database/user, and expose only the
internal Hive gateway/facade network. No Paperclip shell/UI is exposed to product
users. Before copying any Paperclip page in P3, freeze its source to the actual
build revision and regenerate the page/API difference inventory; the historical
page SHA is evidence, not a second running implementation.

The P1 restricted bundle includes the pinned database code and full MIT notices,
plus notices for actual bundled dependencies. When additional source
is incorporated, include the full notices in the distributed service and
absorbed assets. TeamAI contributes future pure parsing/selection logic only;
its CLI, pull/watch, HTTP command plane, MCP execution and global hooks do not run.

## Implementation preflight (2026-10-03)

P2 uses the current production pin `a027f76a726e8a556674eded807c2de0e55f5cc0` as its business-module baseline. The research candidate `ffe5e9e2a8866767cbb48009040bfafd85b56576` is an audited comparison, not another running distribution. The manifest and runtime execution allowlist retain their current values.

| Check | Observed evidence | Implementation consequence |
| --- | --- | --- |
| Company/project/employee/Issue/Pipelines schemas | Both revisions build as a limited schema/validator PoC; 0 server/Provider build inputs | P2 can reuse the current pin; upgrading is not required to obtain Pipelines |
| Pipelines/cases schema and Pipeline validator | The three files have identical normalized SHA-256 at both revisions | Freeze page/API adoption to the actual selected pin; do not treat latest-source research as deployed code |
| Definition vs case revision | Pipelines has no immutable definition revision; case.version is an optimistic lock | Store immutable workflow revisions in the same Paperclip business domain; consume [workflow v1](../../contracts/workflow-v1/README.md) |
| Upstream configuration | enforceTransitions defaults false; automation/config validators retain unknown fields | Hive must enforce transitions and narrow allowed fields; a passed upstream validator does not authorize commands, env, Provider or private context |
| Migration comparison | 288 → 293 journal migrations; previous journal/normalized SQL prefix unchanged; 5 new entries | Version changes still require an isolated migration and data-preservation check |
| Actual PostgreSQL 17 migration | CRLF → LF initially misclassified 273 old checksums; canonical correction left exactly 5 new migrations; P1 task/run, pipeline case and repeat-create identity preserved | Build SQL with LF; correct only proven LF/CRLF aliases in the existing journal before upstream migration; unknown hashes refuse before writes |
| Execution integration | Adapter registry and heartbeat source changed in the candidate; upstream server remains unloaded | Apply/verify registry, actor, pre-adapter preparation and external-recovery patches before loading business execution services |
| Windows Codex host | Current host rejects team/enforced-autonomous admission even with an advertised enforcement capability and an arbitrary evidence reference | P2 must verify actual file/process/environment/network boundaries, expiry/revocation and stop/fence proof before team dispatch |

The checksum correction changes only known migration hashes, under a transaction/lock; record IDs/timestamps and business data remain unchanged. It does not infer that unknown SQL was applied or replay already-applied DDL. The isolated smoke database/container was removed after testing; the existing task database was not touched. The broader upstream-server integration and real team execution remain pending.

Repeat the source PoC from the project root with the audited checkout:

```sh
node config/scripts/audit-paperclip-business-modules.mjs logs/paperclip-prerequisites/upstream/paperclip-ffe5e9e2 ffe5e9e2a8866767cbb48009040bfafd85b56576
node config/scripts/generate-task-workflow-contract.mjs --check
```

Diagnostic receipts are in `logs/paperclip-prerequisites/upstream-audit.json`, `migration-smoke.json`, `checks/` and `container-cleanup.json`; they are ignored artifacts. The canonical contracts and decisions are maintained here and in the existing P2/P3 plans.
