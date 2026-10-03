# Hive task execution contract

This is the current P0 wire contract, `urn:hive:task-execution:1`. It does not
advertise a running TaskExecutionHost or a deployed Paperclip integration.

The validators and inferred TypeScript types live in
[`src/shared/task-execution`](../../../src/shared/task-execution/).
[`task-execution.schema.json`](task-execution.schema.json) is generated from those
validators. Java and adapter consumers must use the same definitions and
[`test-vectors.json`](test-vectors.json), rather than maintain another schema.

Generate and check the schema from the HiveCode project root:

```sh
node config/scripts/generate-task-execution-contract.mjs
node config/scripts/generate-task-execution-contract.mjs --check
```

Each message validates against its named `$defs` entry; the root accepts the wire
message union. Unknown fields, unknown protocol versions, unbounded identifiers,
unsafe integers and incomplete resource requirements are rejected. References are
ASCII opaque identifiers of at most 160 characters. Timestamps are UTC RFC 3339
with millisecond precision. Digests are lowercase SHA-256 hex. The envelope is
limited to 64 KiB at the transport before JSON parsing; transport enforcement is
part of P1, not provided by these object validators.

Identifier, digest, operation-id and currency patterns require the absolute end
of the value, including in validators whose `$` permits a final newline. Fixed
UTC timestamps have exactly 24 characters; timestamps and operation ids require
ASCII digits even in regex engines where `\d` accepts Unicode digits. Generation uses an invocation-specific
directory under `logs/`; it writes and syncs the complete schema before atomically
replacing the published file. `--check` never rewrites that file.
Checks compare the JSON structure, so whitespace and object key order from
repository formatters do not make an unchanged contract stale.
Unknown or duplicate arguments fail before any build or file writes.

Collections over their item limit fail before any elements are parsed. Progress
summaries permit at most 2048 Unicode characters, including supplementary
characters, and reject unpaired surrogates. These limits agree with the published
JSON Schema and the cross-language vectors.

`operationId` uses the existing timestamp-and-32-hex launch operation format.
`operationCallerKey` comes from authenticated host context and is never a command
field. Execution, ownership and business attempt generations have independent
fields. Admission must negotiate `agent.launch.replay-required.v1` and invoke
`agent.launchReplay`; no ordinary-launch fallback or replacement operation id is
allowed after uncertainty.

The command fingerprint uses the existing recursively sorted canonical JSON
SHA-256 implementation. Its input is the parsed command, with `authorizationRef`
and `expiresAt` removed, plus `domain: "hive.task.execution:1"` and the
authenticated caller key. Required capabilities are sorted and deduplicated as a
set. All other requirements, including authorization revision, workspace claim,
write fence and resource requirements, participate. Golden hashes in the vectors
were independently calculated in Python. Renewable authorization must still be
checked for expiry, audience, actions, revocation and current revisions on every
request; matching fingerprints grant no authority.

Capability admission checks the selected Runtime and ownership epoch, mandatory
replay/workspace/stop-proof capabilities and every explicit required capability.
Snapshot requests require the full resource field group and exact advertised
manifest/resolver versions. Team execution requires enforced autonomous policy;
the host must separately validate its enforcement reference before effects.
Capability declarations and structurally valid receipts do not prove actual
enforcement or grant execution permission.

`execution.accepted`, execution events, resource preparation, resource activation
and terminal results are separate facts. Stop requests and `outcome_unknown` keep
the task slot and workspace claim. A result requires an outcome reference and
host-recorded stop proof; success requires `stopped`, settled tools and fenced
writers. Events alone never release a claim or mark a business task done.
`taskExecutionEvidenceRefusal` is asynchronous and verifies activation/result binding against a
durable receipt read from the authenticated execution host. Passing request JSON
as that lookup's result would violate its authority contract. P1/P2 must wire the
lookup to the actual host store and establish proof before recording receipts.
Callers must await its result; sync and async host reads are supported. Failed
reads return `task_evidence_unavailable`, while missing/unconfirmed records return
`task_evidence_unverified`. Neither permits completion or releases a workspace
claim. The host storage/transport must enforce its read deadline. Invalid commands,
invalid caller keys and unavailable capability responses produce explicit refusal
codes instead of validation exceptions at these refusal boundaries.
Resource binding and coverage are checked before reading host storage, so requests
that already contradict the command require no I/O. Valid bound evidence still
requires a matching durable host receipt before it can be accepted.

Resource transport fields map to preparation/activation receipt
`snapshotRef/snapshotDigest`. Installation does not prove loading; loading does
not prove execution completion. Runtime receipts preserve resolver/loader and
coverage evidence, and cannot be authored by the adapter or model. Existing
`SkillInstallReceiptV1` remains unchanged.

Unknown costs stay `null`. A confirmed cost requires an authoritative billing
source, integer millionths and an ISO currency. Native Pi placeholder zero prices
are never confirmed costs. Source event id/revision support deduplication and
corrections; session-cumulative usage requires a session reference. The server
must enforce unique source events and apply cumulative differences before
projecting task costs. This contract performs no billing.

The current scope, persistence design, authorization checks, audited upstream
sources and P1 blockers are recorded in the existing
[P0 plan](../../../docs/Hive-paperclip/P0-架构基线与公共契约开发计划.md#8-实施记录2026-10-01).
