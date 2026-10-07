# External execution failure and recovery boundaries

This is the implementation matrix for the current static, trusted personal Codex
profile. It is not a completed P2 qualification report. Dynamic resources, team
execution and untrusted execution remain unavailable.

| Cut | Durable evidence | Next action and authority | Relevant regression |
| --- | --- | --- | --- |
| Before Runtime admission | No committed execution record | Runtime validates the original authorization and workspace before admission. Rejection creates no execution. | `task-execution-host.test.ts`: expired authority and missing capability rejection |
| After admission, before dispatch | Accepted record and retained task/workspace claim | Runtime queries the original record. Acceptance alone does not prove launch or permit a replacement writer. | `task-execution-recovery.test.ts`: reopened active records and pending admission |
| At the launch boundary | Dispatching record plus the original operation ID/caller/launch fingerprint | Runtime reads its existing launch ledger. An exact committed answer can be bound; pending, missing or conflicting evidence stays unknown. | `task-execution-recovery.test.ts`: lost launch answer, pending/unknown operations and changed fingerprint |
| After launch, before its answer reaches Gateway | Original Runtime execution and immutable binding | Gateway obtains a recovery grant and claims observation of that same execution. It does not call start. | `paperclip-adapter-recovery.test.ts`; `paperclip-task-dispatch.test.mjs`: original execution recovery |
| After artifact collection, before terminal commit | Host candidate plus original execution identity | Runtime requires matching stop/fence evidence and current authority before committing the result. An artifact is insufficient. | `task-execution-host.test.ts`; `task-execution-recovery.test.ts`: late revocation during result I/O |
| After terminal commit, before event acknowledgement | Runtime terminal result and ordered events | Gateway persists complete event pages before advancing its cursor. Missing/conflicting events cannot settle the business task. | `paperclip-task-repository-inbox.test.mjs`; `paperclip-task-repository-postgres.test.mjs` |
| During business settlement | Inbox, cursor, original receipt, task/run projections in one PostgreSQL transaction | The current delivery writer validates the company, driver, binding and task revision. A failed final write rolls back all projections. | `paperclip-task-repository-postgres.test.mjs`: persisted-driver conflict and lease expiry rollback |
| After settlement commit, before its response | Immutable stored receipt and applied event cursor | Replay returns the same outcome without another launch, comment or settlement. | `paperclip-task-dispatch.test.mjs`: committed inbox acknowledgement loss |

Fault injection uses test-only dependency ports, delayed durable writes, response
loss and real PostgreSQL lock waits. Product HTTP bodies contain no fault switches.
The HTTP process test crashes only the service process it created, then starts a
fresh process against the same isolated database. It proves retained cancellation,
credential rotation and refusal while Runtime is unreachable; it does not prove
live Codex recovery or a Runtime restart.

## Core-to-Gateway control

The fork's core startup, periodic cleanup, cancellation and shutdown lifecycle
use an `ExternalExecutionPort`. Its HTTP implementation reads the existing
restricted Gateway descriptor from `HIVE_PAPERCLIP_EXTERNAL_EXECUTION_DESCRIPTOR`.
Both core heartbeat construction paths receive that same port. The restricted
product bundle still excludes upstream heartbeat/server and Provider packages.

`POST /hive/external-execution/{companyId}/{runId}` accepts only
`{"action":"recover"}`, `{"action":"cancel"}` or `{"action":"drain"}`. It
requires the existing private service credential and exact loopback authority;
browser requests and account headers are rejected. Gateway derives account/task
identity from its private company/run/agent/binding rows. The response
`accepted=true, retained=true` acknowledges a control request, never task success,
observer attachment or process termination.

Cancellation and drain intents commit before transport. Per-run drain latches an
entry in the existing bounded delivery map: pending preparation cannot continue
dispatch, periodic scans cannot reacquire it, and explicit recovery/cancellation
waits for the old delivery before sharing one replacement observer. It does not
cancel Runtime or release its task/workspace claim. A cold Gateway restart uses
the original durable binding and Runtime evidence.

The managed copy now retains the original directory's device, inode and birth
time as decimal strings in both its execution record and private binding. Binding
recovery compares those records and checks the actual directory again whenever
the recovered grant is used. A replacement at the same path, a junction, missing
original evidence or a changed binding cannot release the existing execution
claim or authorize another launch. Ordinary file writes inside the same directory
remain valid. Preparation cleanup also preserves a replacement directory.
`local-task-workspace-recovery.test.ts` reopens the real persistent store and uses
actual directories/junctions; `task-managed-copy.test.ts` covers the copy guards.
These checks do not establish an OS/tool sandbox or a full desktop restart.

Remaining qualification includes live authorized Codex service-restart/cancel
tests, full Runtime reconstruction, supported host enforcement, and the requested
stage reviews/publication. Resource loading and team workflows require their own
evidence; static receipts do not qualify them.
